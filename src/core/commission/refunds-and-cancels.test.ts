import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";

/**
 * Возврат и отмена оплаченного заказа внутри месяца комиссии — настоящим кодом
 * оплаты, возврата и отклонения, а не заглушками: комиссия не берётся с
 * возвращённого и отменённого, а каждая оплата, переплата и оплата по закрытому
 * заказу остаётся событием в истории заказа с суммой и номером платежа.
 */
let db: FakeDb;
const reported: string[] = [];
vi.mock("@/core/db/client.server", () => ({ serviceDb: () => db, tenantDb: () => db }));
vi.mock("@/core/settings/settings", () => ({ getSettings: async () => ({}) }));
vi.mock("@/lib/errors", () => ({
  reportError: async (e: unknown) => {
    reported.push(e instanceof Error ? e.message : String(e));
  },
}));

const { commissionForMonth } = await import("./commission.server");
const { markProofVerified, rejectOrder } = await import("@/core/orders/orders");
const { refundOrder } = await import("@/core/orders/refund");
const { markPaidOnline } = await import("@/core/payments/payment");
const { recordOrderEvent } = await import("@/core/orders/events");

const BOT = "00000000-0000-0000-0000-0000000000e4";
const TG = 4242;
const ctx = () =>
  ({
    db,
    timezone: "Asia/Almaty",
    tenant: { id: BOT, plan: "flowers.basic", modules: {}, settings: {} },
  }) as unknown as TenantContext;

const events = (orderId: number, kind: string) =>
  db.tables
    .zernio_logs!.filter((e) => e.event_type === `order.${kind}`)
    .filter((e) => (e.payload as { order_id: number }).order_id === orderId)
    .map((e) => e.payload as Record<string, unknown>);

function order(over: Record<string, unknown> = {}) {
  return {
    id: 1,
    bot_id: BOT,
    platform: "web",
    status: "awaiting_confirmation",
    total: 150_000,
    paid_amount: 0,
    currency: "KZT",
    fulfillment_kind: "digital",
    telegram_id: TG,
    points_used: 0,
    points_earned: 0,
    promo_code: null,
    admin_note: null,
    payment_proof_hash: "h1",
    created_at: "2027-02-10T10:00:00Z",
    updated_at: "2027-02-10T10:00:00Z",
    ...over,
  };
}

const base = () => commissionForMonth(ctx(), "2027-02", true);

beforeEach(() => {
  reported.length = 0;
  // «Сегодня» — внутри месяца комиссии, возврат бывает позже заказа.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2027-02-20T10:00:00Z"));
  db = fakeDb({ unique: { zernio_logs: [["event_id"]] } });
  // created_at у журнала в базе ставится по умолчанию.
  const from = db.from.bind(db);
  db.from = ((t: string) => {
    const q = from(t) as unknown as Record<string, (...a: unknown[]) => unknown>;
    if (t === "zernio_logs") {
      const insert = q.insert!.bind(q);
      q.insert = (r: unknown) => insert({ created_at: new Date().toISOString(), ...(r as object) });
    }
    return q as never;
  }) as typeof db.from;
  db.tables.orders = [order()];
  db.tables.order_items = [];
  db.tables.zernio_logs = [];
  db.tables.gift_certificates = [];
  db.tables.promo_codes = [];
  db.tables.bot_users = [{ bot_id: BOT, telegram_id: TG, user_key: `tg_${TG}`, loyalty_points: 0 }];
});

afterEach(() => vi.useRealTimers());

describe("оплата чеком → возврат", () => {
  it("оплаченный заказ даёт комиссию; платёж с суммой и валютой — в истории", async () => {
    expect(await markProofVerified(ctx(), 1, "h1", "OCR ok", { amount: 150_000 })).toBe(true);
    expect(events(1, "payment")).toEqual([
      expect.objectContaining({ amount: 150_000, currency: "KZT", source: "receipt" }),
    ]);
    expect(await base()).toMatchObject({ sales: 150_000, commission: 10_000 });
  });

  it("частичный возврат уменьшает базу, полный — обнуляет; в истории оба возврата с суммами", async () => {
    await markProofVerified(ctx(), 1, "h1", "OCR ok", { amount: 150_000 });
    await refundOrder(ctx(), 1, { amount: 40_000, reason: "брак" }, "admin:Анна");
    expect(await base()).toMatchObject({ sales: 110_000, commission: 6_000 });
    expect(db.tables.orders![0]!.status).toBe("paid");
    await refundOrder(ctx(), 1, { amount: 110_000 }, "admin:Анна");
    expect(db.tables.orders![0]!.status).toBe("refunded");
    expect(await base()).toMatchObject({ sales: 0, orders: 0, commission: 0 });
    expect(events(1, "refund").map((e) => e.amount)).toEqual([40_000, 110_000]);
    // История оплаты не стёрта возвратом.
    expect(events(1, "payment")).toHaveLength(1);
  });

  it("переплата чеком: в журнале сумма чека и поле «переплата», база — итог заказа, не чек", async () => {
    await markProofVerified(ctx(), 1, "h1", "OCR ok", { amount: 160_000 });
    expect(events(1, "payment")[0]).toMatchObject({ amount: 160_000, overpaid: 10_000 });
    expect(await base()).toMatchObject({ sales: 150_000, commission: 10_000 });
  });
});

describe("отмена и отклонение", () => {
  it("оплаченный заказ отклонён продавцом: комиссии нет, платёж из истории не пропал", async () => {
    await markProofVerified(ctx(), 1, "h1", "OCR ok", { amount: 150_000 });
    expect(await rejectOrder(ctx(), 1, "admin:Анна")).toBe(true);
    expect(db.tables.orders![0]!.status).toBe("rejected");
    expect(await base()).toMatchObject({ sales: 0, commission: 0 });
    expect(events(1, "payment")).toHaveLength(1);
    expect(events(1, "rejected")).toHaveLength(1);
  });

  it("неоплаченный заказ с истёкшим сроком (cancelled) комиссии не несёт", async () => {
    db.tables.orders = [order({ status: "awaiting_payment" })];
    await rejectOrder(ctx(), 1, "system", { to: "cancelled" });
    expect(db.tables.orders![0]!.status).toBe("cancelled");
    expect(await base()).toMatchObject({ sales: 0, commission: 0 });
  });
});

describe("оплата по закрытому заказу остаётся событием", () => {
  it("шлюз прислал деньги по отменённому заказу: заказ не меняется, событие с суммой, шлюзом и номером платежа, один раз", async () => {
    db.tables.orders = [order({ status: "cancelled" })];
    const r = await markPaidOnline(ctx(), 1, 150_000, "Robokassa", "inv-77");
    expect(r).toMatchObject({ ok: true, alreadyDone: true, closed: true, status: "cancelled" });
    const { recordUnappliedPayment } = await import("@/core/payments/payment");
    const unapplied = {
      amount: 150_000,
      currency: "KZT",
      provider: "Robokassa",
      ref: "inv-77",
      status: "cancelled",
    };
    expect(await recordUnappliedPayment(ctx(), 1, "payment_on_closed", unapplied)).toBe(true);
    expect(await recordUnappliedPayment(ctx(), 1, "payment_on_closed", unapplied)).toBe(false);
    expect(events(1, "payment_on_closed")).toEqual([
      expect.objectContaining({
        amount: 150_000,
        currency: "KZT",
        provider: "Robokassa",
        invId: "inv-77",
      }),
    ]);
    expect(db.tables.orders![0]!.status).toBe("cancelled");
    expect(await base()).toMatchObject({ sales: 0, commission: 0 });
  });

  it("чек распознан, а заказ успели отменить: оплата не записана, но событие с суммой и номером чека есть", async () => {
    db.tables.orders = [order({ status: "cancelled" })];
    expect(await markProofVerified(ctx(), 1, "h1", "OCR ok", { amount: 150_000 })).toBe(false);
    expect(events(1, "payment")).toEqual([]);
    expect(events(1, "payment_on_closed")).toEqual([
      expect.objectContaining({
        amount: 150_000,
        currency: "KZT",
        provider: "receipt",
        invId: "h1",
        status: "cancelled",
      }),
    ]);
    expect(db.tables.orders![0]!.status).toBe("cancelled");
    expect(await base()).toMatchObject({ sales: 0, commission: 0 });
  });

  it("чек не прошёл по другой причине (заказ жив, файл подменён): события «по закрытому» нет", async () => {
    db.tables.orders = [order({ payment_proof_hash: "other" })];
    expect(await markProofVerified(ctx(), 1, "h1", "OCR ok", { amount: 150_000 })).toBe(false);
    expect(events(1, "payment_on_closed")).toEqual([]);
  });
});

describe("журнал платежа не теряется молча", () => {
  it("первая запись события оплаты не удалась — повтор записывает его, ошибки нет", async () => {
    const real = db.from.bind(db);
    let failed = 0;
    db.from = ((t: string) => {
      const q = real(t) as unknown as Record<string, (...a: unknown[]) => unknown>;
      if (t === "zernio_logs") {
        const insert = q.insert!.bind(q);
        q.insert = (r: unknown) =>
          failed++ === 0
            ? Promise.resolve({ data: null, error: { message: "connection reset" } })
            : insert(r);
      }
      return q as never;
    }) as typeof db.from;
    await recordOrderEvent(ctx(), 1, "payment", { amount: 5, currency: "KZT" }, "system");
    expect(events(1, "payment")).toHaveLength(1);
    expect(reported).toEqual([]);
  });

  it("первая запись дошла, но ответ потерян: повтор упирается в event_id — дубля нет, ошибки нет", async () => {
    const real = db.from.bind(db);
    let first = true;
    db.from = ((t: string) => {
      const q = real(t) as unknown as Record<string, (...a: unknown[]) => unknown>;
      if (t === "zernio_logs") {
        const insert = q.insert!.bind(q);
        q.insert = async (r: unknown) => {
          const res = await insert(r);
          if (first) {
            first = false;
            return { data: null, error: { message: "connection reset" } };
          }
          return res;
        };
      }
      return q as never;
    }) as typeof db.from;
    await recordOrderEvent(ctx(), 1, "payment", { amount: 5, currency: "KZT" }, "system");
    expect(events(1, "payment")).toHaveLength(1);
    expect(reported).toEqual([]);
  });

  it("запись не удаётся и со второго раза — ошибка в журнале ошибок, заказ не ломается; не денежное событие — только консоль", async () => {
    const real = db.from.bind(db);
    db.from = ((t: string) => {
      const q = real(t) as unknown as Record<string, (...a: unknown[]) => unknown>;
      if (t === "zernio_logs")
        q.insert = () => Promise.resolve({ data: null, error: { message: "база недоступна" } });
      return q as never;
    }) as typeof db.from;
    await recordOrderEvent(ctx(), 1, "payment", { amount: 5 }, "system");
    expect(reported).toHaveLength(1);
    expect(reported[0]).toContain("payment");
    expect(reported[0]).toContain("#1");
    await recordOrderEvent(ctx(), 1, "reminded", {}, "system");
    expect(reported).toHaveLength(1);
  });
});
