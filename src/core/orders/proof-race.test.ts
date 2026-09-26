import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";

/**
 * Чек, пришедший, пока заказ выдаётся. attachPaymentProof читает заказ,
 * грузит файл в хранилище и только потом пишет статус; за это время продавец
 * или автопроверка первого чека успевают забрать заказ на выдачу. Запись
 * «ждёт подтверждения» поверх «выдаётся» снова открывала заказ, и второй
 * чек запускал вторую выдачу.
 */
let db: FakeDb;
let duringUpload: () => void = () => {};
const removed: string[][] = [];
vi.mock("@/core/db/client.server", () => ({
  serviceDb: () => ({
    storage: {
      from: () => ({
        upload: async () => {
          duringUpload();
          return { data: {}, error: null };
        },
        remove: async (keys: string[]) => {
          removed.push(keys);
          return { data: [], error: null };
        },
      }),
    },
  }),
}));

const { attachPaymentProof, claimOrderForDelivery } = await import("./orders");

const BOT = "00000000-0000-0000-0000-00000000000d";
const file = (n: number) => ({
  bytes: new Uint8Array([0xff, 0xd8, 0xff, n]),
  mime: "image/jpeg",
  ext: "jpg",
});
const ctx = () => ({ tenant: { id: BOT, modules: {} }, db }) as unknown as TenantContext;
const order = () => db.tables.orders![0]!;

beforeEach(() => {
  db = fakeDb();
  db.tables.orders = [
    {
      id: 7,
      bot_id: BOT,
      status: "awaiting_confirmation",
      fulfillment_kind: "digital",
      payment_proof_path: "old.jpg",
      payment_proof_hash: "old",
      order_items: [],
    },
  ];
  duringUpload = () => {};
  removed.length = 0;
});

describe("чек во время выдачи", () => {
  it("заказ, который забрали на выдачу, пока грузился чек, не возвращается в «ждёт подтверждения»", async () => {
    duringUpload = () => {
      order().status = "delivering";
    };
    const r = await attachPaymentProof(ctx(), 7, file(1));
    expect(r).toEqual({ ok: false, reason: "closed" });
    expect(order()).toMatchObject({ status: "delivering", payment_proof_path: "old.jpg" });
    // Заказ не открылся — вторую выдачу запустить нечем.
    expect(await claimOrderForDelivery(ctx(), 7)).toBeNull();
    // Загруженный впустую файл не копится в хранилище.
    expect(removed).toHaveLength(1);
  });

  it("то же, если заказ успели выдать целиком", async () => {
    duringUpload = () => {
      order().status = "delivered";
    };
    expect(await attachPaymentProof(ctx(), 7, file(1))).toEqual({ ok: false, reason: "closed" });
    expect(order().status).toBe("delivered");
  });

  it("два чека подряд и выдача между ними — выдача ровно одна", async () => {
    const first = await attachPaymentProof(ctx(), 7, file(1));
    expect(first.ok).toBe(true);
    // Второй чек грузится, а в это время первый распознан и заказ выдаётся.
    let claimed: unknown = null;
    duringUpload = () => {
      order().status = "delivering";
      claimed = order().id;
    };
    const second = await attachPaymentProof(ctx(), 7, file(2));
    expect(claimed).toBe(7);
    expect(second).toEqual({ ok: false, reason: "closed" });
    expect(await claimOrderForDelivery(ctx(), 7)).toBeNull();
  });

  it("обычный чек к ждущему заказу принимается", async () => {
    const r = await attachPaymentProof(ctx(), 7, file(1));
    expect(r.ok).toBe(true);
    expect(order().status).toBe("awaiting_confirmation");
    expect(order().payment_proof_path).not.toBe("old.jpg");
    expect(removed).toEqual([]);
  });
});

describe("файл чека проверяется до загрузки", () => {
  it("не картинка и не PDF (HTML, видео) — отказ, в хранилище ничего не уходит, заказ не меняется", async () => {
    let uploaded = false;
    duringUpload = () => {
      uploaded = true;
    };
    const fake = { bytes: new TextEncoder().encode("<html>"), mime: "image/jpeg", ext: "jpg" };
    expect(await attachPaymentProof(ctx(), 7, fake)).toEqual({ ok: false, reason: "invalid_file" });
    const video = {
      bytes: new Uint8Array([0, 0, 0, 0x18, ...new TextEncoder().encode("ftypmp42")]),
      mime: "image/heic",
      ext: "heic",
    };
    expect(await attachPaymentProof(ctx(), 7, video)).toEqual({
      ok: false,
      reason: "invalid_file",
    });
    expect(uploaded).toBe(false);
    expect(order()).toMatchObject({ payment_proof_path: "old.jpg", payment_proof_hash: "old" });
  });

  it("Telegram отдаёт octet-stream — PDF сохраняется как .pdf", async () => {
    const pdf = {
      bytes: new TextEncoder().encode("%PDF-1.4"),
      mime: "application/octet-stream",
      ext: "bin",
    };
    const r = await attachPaymentProof(ctx(), 7, pdf);
    expect(r.ok).toBe(true);
    expect(order().payment_proof_path).toMatch(/\.pdf$/);
  });
});
