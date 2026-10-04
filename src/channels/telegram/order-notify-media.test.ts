import { describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { OrderWithItems } from "@/core/orders/orders";
import { notifyAdminNewOrder } from "./admin-notify";
import { imageUrl } from "@/core/catalog/catalog";
import { proofCaption } from "./order-notify-media";
import type { TelegramApi } from "./api";

vi.mock("@/core/orders/admin", async (orig) => ({
  ...(await orig<typeof import("@/core/orders/admin")>()),
  proofSignedUrl: async (_ctx: unknown, path: string) => `https://signed.test/${path}?t=1`,
}));

/** Б1: уведомление продавцу из Direct — альбом с фото товаров и чек ответом, с кнопками. */
const BOT = "bot-1";

function setup(over: Partial<OrderWithItems> = {}, apiOverride?: (m: string) => unknown) {
  const db: FakeDb = fakeDb();
  db.tables.app_settings = [{ bot_id: BOT, key: "admin_chat_id", value: "111" }];
  db.tables.product_images = [
    { id: "i2", bot_id: BOT, product_id: "p1", image_path: "p1-b.jpg", sort_order: 2 },
    { id: "i1", bot_id: BOT, product_id: "p1", image_path: "p1-a.jpg", sort_order: 1 },
    { id: "i3", bot_id: BOT, product_id: "p2", image_path: "p2.jpg", sort_order: 1 },
  ];
  db.tables.orders = [
    {
      id: 7,
      order_no: 7,
      bot_id: BOT,
      telegram_id: 42,
      platform: "instagram",
      status: "awaiting_confirmation",
      total: 1500,
      currency: "KZT",
      fulfillment_kind: "digital",
      payment_proof_path: "bot-1/order-7/1.jpg",
      order_items: [
        { id: "a", product_id: "p1", name_snapshot: "Раз", quantity: 1, price_snapshot: 500 },
        { id: "b", product_id: "p2", name_snapshot: "Два", quantity: 1, price_snapshot: 500 },
        { id: "c", product_id: "p1", name_snapshot: "Раз ещё", quantity: 1, price_snapshot: 500 },
        { id: "d", product_id: "p3", name_snapshot: "Без фото", quantity: 1, price_snapshot: 0 },
      ],
      ...over,
    },
  ];
  const ctx = {
    tenant: { id: BOT, status: "active", modules: {}, settings: { default_locale: "ru" } },
    db,
    appUrl: "https://app.test",
    timezone: "Asia/Almaty",
  } as unknown as TenantContext;
  let nextId = 500;
  const calls: Array<[string, Record<string, unknown>]> = [];
  const api = {
    call: vi.fn(async (method: string, p: Record<string, unknown>) => {
      calls.push([method, p]);
      const forced = apiOverride?.(method);
      if (forced) return forced;
      return { ok: true, result: { message_id: nextId++ } };
    }),
  } as unknown as TelegramApi;
  const order = () => db.tables.orders![0] as unknown as OrderWithItems;
  return { db, ctx, api, calls, order };
}

const methods = (c: Array<[string, unknown]>) => c.map(([m]) => m);

describe("уведомление о заказе из Direct: фото и чек", () => {
  it("альбом из фото товаров (по одному на товар, без повторов), текст, чек ответом с кнопками", async () => {
    const { ctx, api, calls, order } = setup();
    await notifyAdminNewOrder(ctx, api, order(), null);
    expect(methods(calls)).toEqual(["sendMediaGroup", "sendMessage", "sendPhoto"]);
    const media = calls[0]![1].media as Array<{ media: string; caption?: string }>;
    expect(media.map((m) => m.media)).toEqual([imageUrl(ctx, "p1-a.jpg"), imageUrl(ctx, "p2.jpg")]);
    expect(media[0]!.caption).toContain("Новый заказ #7");
    expect(media[1]!.caption).toBeUndefined();
    const text = calls[1]![1];
    expect(text.reply_markup).toBeDefined();
    const proof = calls[2]![1];
    expect(proof.photo).toBe("https://signed.test/bot-1/order-7/1.jpg?t=1");
    expect(proof.caption).toBe("🧾 Чек оплаты — заказ #7");
    expect(proof.reply_parameters).toMatchObject({ message_id: 501 });
    expect(proof.reply_markup).toEqual(text.reply_markup);
  });

  it("один товар с фото — sendPhoto; чек-PDF уходит документом", async () => {
    const { ctx, api, calls, order, db } = setup({ payment_proof_path: "bot-1/order-7/1.pdf" });
    db.tables.orders![0]!.order_items = [
      { id: "a", product_id: "p2", name_snapshot: "Два", quantity: 1, price_snapshot: 500 },
    ];
    await notifyAdminNewOrder(ctx, api, order(), null);
    expect(methods(calls)).toEqual(["sendPhoto", "sendMessage", "sendDocument"]);
  });

  it("товар без фото и без чека — только текст", async () => {
    const { ctx, api, calls, order, db } = setup({ payment_proof_path: null });
    db.tables.orders![0]!.order_items = [
      { id: "d", product_id: "p3", name_snapshot: "Без фото", quantity: 1, price_snapshot: 0 },
    ];
    await notifyAdminNewOrder(ctx, api, order(), null);
    expect(methods(calls)).toEqual(["sendMessage"]);
  });

  it("Telegram отверг альбом — текст ушёл один раз", async () => {
    const { ctx, api, calls, order } = setup({}, (m) =>
      m === "sendMediaGroup"
        ? { ok: false, error_code: 400, description: "wrong file identifier" }
        : null,
    );
    await notifyAdminNewOrder(ctx, api, order(), null);
    expect(methods(calls).filter((m) => m === "sendMessage")).toHaveLength(1);
    expect(methods(calls).filter((m) => m === "sendMediaGroup")).toHaveLength(1);
  });

  it("фото отвергнуто наверняка — чек уходит документом; обрыв не повторяется", async () => {
    const a = setup({}, (m) =>
      m === "sendPhoto" ? { ok: false, error_code: 400, description: "too big" } : null,
    );
    await notifyAdminNewOrder(a.ctx, a.api, a.order(), null);
    expect(methods(a.calls).slice(-2)).toEqual(["sendPhoto", "sendDocument"]);

    const b = setup({}, (m) => (m === "sendPhoto" ? { ok: false, description: "timeout" } : null));
    await notifyAdminNewOrder(b.ctx, b.api, b.order(), null);
    expect(methods(b.calls).filter((m) => m === "sendDocument")).toHaveLength(0);
    expect(methods(b.calls).filter((m) => m === "sendPhoto")).toHaveLength(1);
  });

  it("подпись чека на четырёх языках", () => {
    for (const l of ["ru", "kk", "en", "uz"]) expect(proofCaption(l, 7)).toContain("7");
    expect(new Set(["ru", "kk", "en", "uz"].map((l) => proofCaption(l, 7))).size).toBe(4);
  });
});
