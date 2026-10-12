import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import type { VerifyResult } from "@/core/receipts/verify.server";
import type { AuditDeps } from "./receipt-audit.server";

/**
 * Прогон аудита чеков (receipt-audit.server) на базе в памяти: порядок с
 * новых к старым, пропуск заказов без файла, повтор файла в одном прогоне
 * и главное — аудит ничего не пишет в заказы.
 */
const BOT = "00000000-0000-0000-0000-0000000000aa";
const OTHER = "00000000-0000-0000-0000-0000000000bb";
let base: FakeDb;
let servedBy: string | undefined;

vi.mock("@/core/db/client.server", () => ({ serviceDb: () => base }));
vi.mock("@/core/tenant/resolve.server", () => ({
  requireTenant: async () => ({
    id: BOT,
    modules: { receipt_ocr: true },
    settings: { served_by: servedBy },
  }),
  tenantContext: (t: unknown) => ({ tenant: t, db: base }),
}));
vi.mock("@/core/receipts/verify.server", () => ({
  receiptReaderConfigured: () => true,
  receiptOcrAutoEnabled: async () => true,
}));

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

function order(id: number, over: Record<string, unknown> = {}) {
  return {
    id,
    bot_id: BOT,
    display_no: id,
    order_no: id,
    status: "delivered",
    total: 1000,
    currency: "KZT",
    fulfillment_kind: "digital",
    payment_proof_path: `${BOT}/order-${id}/1.jpg`,
    payment_proof_hash: null,
    admin_note: null,
    created_at: "2026-09-01T00:00:00Z",
    ...over,
  };
}

function deps(
  files: Record<string, Uint8Array>,
  result: VerifyResult,
): AuditDeps & {
  verify: ReturnType<typeof vi.fn>;
} {
  return {
    download: async (p) => files[p] ?? null,
    verify: vi.fn(async () => result),
  };
}

beforeEach(() => {
  base = fakeDb();
  base.tables.app_settings = [];
  servedBy = "v2";
});

describe("scanNextReceipt — аудит чеков оператора", () => {
  it("с новых к старым: один чек за шаг, чужой клиент и заказы без файла не берутся", async () => {
    base.tables.orders = [
      order(1),
      order(2, { payment_proof_path: "robokassa" }),
      order(3),
      order(4, { bot_id: OTHER, payment_proof_path: `${OTHER}/order-4/1.jpg` }),
    ];
    const { scanNextReceipt } = await import("./receipt-audit.server");
    const d = deps(
      { [`${BOT}/order-3/1.jpg`]: JPEG, [`${BOT}/order-1/1.jpg`]: JPEG },
      { ok: true, matchedAmount: 1000 },
    );
    const first = await scanNextReceipt(BOT, {}, d);
    expect(first.rows.map((r) => r.orderId)).toEqual([3]);
    expect(first).toMatchObject({ afterId: 3, remaining: 1, done: false });
    const second = await scanNextReceipt(BOT, { afterId: first.afterId }, d);
    expect(second.rows.map((r) => r.orderId)).toEqual([1]);
    expect(second.done).toBe(true);
    expect(d.verify).toHaveBeenCalledTimes(2);
  });

  it("выдан руками, а OCR отклонил бы — «опасно»; заказ при этом не меняется", async () => {
    base.tables.orders = [order(7, { admin_note: "выдано продавцом" })];
    const before = JSON.stringify(base.tables.orders);
    const { scanNextReceipt } = await import("./receipt-audit.server");
    const r = await scanNextReceipt(
      BOT,
      {},
      deps(
        { [`${BOT}/order-7/1.jpg`]: JPEG },
        { ok: false, reason: "payment_failed", detail: "платёж не прошёл" },
      ),
    );
    expect(r.rows[0]!.comparison).toMatchObject({ severity: "danger", actual: "manual_accepted" });
    expect(JSON.stringify(base.tables.orders)).toBe(before);
  });

  it("файла нет в Storage — строка «не прочитан», модель не зовём, идём к следующему", async () => {
    base.tables.orders = [order(5), order(6)];
    const { scanNextReceipt } = await import("./receipt-audit.server");
    const d = deps({ [`${BOT}/order-5/1.jpg`]: JPEG }, { ok: true, matchedAmount: 1000 });
    const r = await scanNextReceipt(BOT, {}, d);
    expect(r.rows.map((x) => [x.orderId, x.comparison.severity])).toEqual([
      [6, "skip"],
      [5, "info"],
    ]);
    expect(d.verify).toHaveBeenCalledTimes(1);
  });

  it("тот же файл уже встретился в прогоне на другом заказе — повтор", async () => {
    base.tables.orders = [order(9, { status: "awaiting_confirmation" })];
    const { scanNextReceipt } = await import("./receipt-audit.server");
    const { proofHashes } = await import("@/core/orders/proof-hash");
    const r = await scanNextReceipt(
      BOT,
      { seenHashes: [{ hash: proofHashes(JPEG).stored, orderId: 8, displayNo: 8 }] },
      deps({ [`${BOT}/order-9/1.jpg`]: JPEG }, { ok: true, matchedAmount: 1000 }),
    );
    expect(r.rows[0]!.ocrReason).toBe("receipt_reused");
    expect(r.rows[0]!.comparison.detail).toContain("№8");
  });

  it("клиент прежней платформы: хеш без заметки — след автовыдачи, как в v1", async () => {
    servedBy = undefined;
    base.tables.orders = [order(11, { payment_proof_hash: "h" })];
    const { scanNextReceipt } = await import("./receipt-audit.server");
    const r = await scanNextReceipt(
      BOT,
      {},
      deps({ [`${BOT}/order-11/1.jpg`]: JPEG }, { ok: true, matchedAmount: 1000 }),
    );
    expect(r.rows[0]!.comparison.actual).toBe("auto_accepted");
  });
});
