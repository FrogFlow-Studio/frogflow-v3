import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";

/**
 * Вебхук ApiPay продавца (оплата Kaspi) по настоящему пути оплаты: маршрут,
 * `getOrder`, `markPaidOnline`, журнал заказа, `reportUnappliedPayment` и
 * `applyProviderRefund` — настоящие, на подставной базе. Подменены только
 * граница арендатора, настройки шлюза, Telegram и фон: результат виден в
 * заказе и в его журнале.
 */
const BOT = "b41a34cb-7944-441b-8f71-503184fc0f1f";
const SECRET = "whsec-kaspi";
let db: FakeDb;
let testMode = false;
const notifyAdminsHtml = vi.fn(async (..._a: unknown[]) => 1);
const afterPaidOnline = vi.fn(async (..._a: unknown[]) => {});

vi.mock("@/core/tenant/resolve.server", () => ({
  resolveTenant: async () => ({ id: BOT, settings: { served_by: "v2" }, modules: {} }),
  tenantContext: (tenant: unknown) => ({ tenant, db, appUrl: "https://app.test" }),
}));
vi.mock("@/core/settings/settings", () => ({ getSettings: async () => ({}) }));
vi.mock("@/core/payments/payment", async (orig) => {
  const real = await orig<typeof import("@/core/payments/payment")>();
  return {
    ...real,
    kaspiApipayFor: async () => ({ ready: true, apiKey: "k", webhookSecret: SECRET, testMode }),
  };
});
vi.mock("@/channels/telegram/notify", () => ({ notifyAdminsHtml }));
vi.mock("@/app/payments/paid-online.server", () => ({ afterPaidOnline }));
vi.mock("@/lib/background", () => ({ runInBackground: (t: () => Promise<void>) => t() }));

const { Route } = await import("@/routes/api/kaspi.$botId");
type Handler = (a: { request: Request; params: Record<string, string> }) => Promise<Response>;
const post = (Route.options as unknown as { server: { handlers: { POST: Handler } } }).server
  .handlers.POST;

function call(body: Record<string, unknown>, secret = SECRET) {
  const raw = JSON.stringify(body);
  const sig = `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;
  return post({
    request: new Request(`https://app.test/api/kaspi/${BOT}`, {
      method: "POST",
      body: raw,
      headers: { "x-webhook-signature": sig },
    }),
    params: { botId: BOT },
  });
}
const paid = (inv: Record<string, unknown> = {}) => ({
  event: "invoice.status_changed",
  invoice: {
    id: 9001,
    status: "paid",
    amount: "4500.00",
    external_order_id: "ff-ord:42",
    is_sandbox: false,
    ...inv,
  },
});
const order = () => db.tables.orders!.find((o) => o.id === 42)!;
const events = (type: string) => db.tables.zernio_logs!.filter((e) => e.event_type === type);

beforeEach(() => {
  testMode = false;
  notifyAdminsHtml.mockClear();
  afterPaidOnline.mockClear();
  db = fakeDb({ unique: { zernio_logs: [["event_id"]] } });
  db.tables.orders = [
    {
      id: 42,
      bot_id: BOT,
      display_no: 7,
      status: "awaiting_payment",
      fulfillment_kind: "digital",
      admin_note: null,
      paid_amount: 0,
      total: 4500,
      currency: "KZT",
    },
  ];
  db.tables.zernio_logs = [];
});

describe("вебхук Kaspi (ApiPay): настоящий путь оплаты", () => {
  it("оплата — заказ оплачен на сумму, платёж с номером ApiPay в журнале, выдача один раз", async () => {
    expect((await call(paid())).status).toBe(200);
    expect(order()).toMatchObject({ status: "paid", paid_amount: 4500 });
    expect(events("order.payment")).toHaveLength(1);
    expect(events("order.payment")[0]!.payload).toMatchObject({
      order_id: 42,
      amount: 4500,
      provider: "Kaspi (ApiPay)",
      invId: "9001",
    });
    expect(afterPaidOnline).toHaveBeenCalledTimes(1);
    await call(paid());
    expect(events("order.payment")).toHaveLength(1);
    expect(afterPaidOnline).toHaveBeenCalledTimes(1);
  });

  it("гонка: две одновременные отметки оплаты одного заказа — одна оплата в журнале", async () => {
    // Повтор вебхука ApiPay, пришедший, пока первый ещё пишет, упирается в ту же
    // условную запись markPaidOnline (статус «ждёт оплаты»): выигрывает одна.
    const { markPaidOnline } = await import("@/core/payments/payment");
    const ctx = { tenant: { id: BOT, modules: {} }, db } as unknown as Parameters<
      typeof markPaidOnline
    >[0];
    const [a, b] = await Promise.all([
      markPaidOnline(ctx, 42, 4500, "Kaspi (ApiPay)", "9001"),
      markPaidOnline(ctx, 42, 4500, "Kaspi (ApiPay)", "9001"),
    ]);
    expect([a.alreadyDone, b.alreadyDone].sort()).toEqual([false, true]);
    expect(order()).toMatchObject({ status: "paid", paid_amount: 4500 });
    expect(events("order.payment")).toHaveLength(1);
    // Опоздавший вебхук после этого — 200 без второй выдачи.
    expect((await call(paid())).status).toBe(200);
    expect(afterPaidOnline).not.toHaveBeenCalled();
    expect(events("order.payment")).toHaveLength(1);
  });

  it("неверная подпись — 401, заказ не тронут", async () => {
    expect((await call(paid(), "чужой секрет")).status).toBe(401);
    expect(order()).toMatchObject({ status: "awaiting_payment", paid_amount: 0 });
  });

  it("песочная оплата не засчитывается, пока у продавца не включён тестовый режим", async () => {
    await call(paid({ is_sandbox: true }));
    await call(paid({ is_sandbox: undefined }));
    expect(order()).toMatchObject({ status: "awaiting_payment", paid_amount: 0 });
    expect(events("order.payment")).toHaveLength(0);
    testMode = true;
    await call(paid({ is_sandbox: true }));
    expect(order()).toMatchObject({ status: "paid", paid_amount: 4500 });
  });

  it("чужая сумма — заказ не оплачен, сумма и номер платежа в журнале, продавцу одно уведомление", async () => {
    await call(paid({ amount: 450 }));
    await call(paid({ amount: 450 }));
    expect(order()).toMatchObject({ status: "awaiting_payment", paid_amount: 0 });
    const mismatch = events("order.payment_mismatch");
    expect(mismatch).toHaveLength(1);
    expect(mismatch[0]!.payload).toMatchObject({ amount: 450, currency: "KZT", invId: "9001" });
    expect(notifyAdminsHtml).toHaveBeenCalledTimes(1);
    expect(afterPaidOnline).not.toHaveBeenCalled();
  });

  it("оплата по отменённому заказу — статус не меняется, платёж в журнале, одно уведомление", async () => {
    order().status = "cancelled";
    await call(paid());
    await call(paid());
    expect(order()).toMatchObject({ status: "cancelled", paid_amount: 0 });
    const closed = events("order.payment_on_closed");
    expect(closed).toHaveLength(1);
    expect(closed[0]!.payload).toMatchObject({ amount: 4500, invId: "9001", status: "cancelled" });
    expect(notifyAdminsHtml).toHaveBeenCalledTimes(1);
    expect(afterPaidOnline).not.toHaveBeenCalled();
  });

  it("полный возврат в ApiPay — возврат с суммой и номером платежа в журнале заказа", async () => {
    await call(paid());
    const refund = {
      event: "invoice.refunded",
      invoice: { id: 9001, external_order_id: "ff-ord:42", is_fully_refunded: true },
    };
    expect((await call(refund)).status).toBe(200);
    const r = events("order.refund");
    expect(r).toHaveLength(1);
    expect(r[0]!.payload).toMatchObject({ amount: 4500 });
    expect(String((r[0]!.payload as Record<string, unknown>).reason)).toContain("платёж 9001");
    await call(refund);
    expect(events("order.refund")).toHaveLength(1);
  });

  it("частичный возврат — заказ не трогаем, продавцу уведомление", async () => {
    await call(paid());
    await call({
      event: "invoice.refunded",
      invoice: { id: 9001, external_order_id: "ff-ord:42", is_fully_refunded: false },
    });
    expect(events("order.refund")).toHaveLength(0);
    expect(notifyAdminsHtml).toHaveBeenCalledTimes(1);
    expect(String(notifyAdminsHtml.mock.calls[0]![1])).toContain("частичный возврат");
  });

  it("чужие события и заказы — 200 без действий", async () => {
    await call(paid({ status: "expired" }));
    await call(paid({ external_order_id: "ff-inv:abc" }));
    await call({ event: "invoice.qr_scanned", invoice: { id: 1 } });
    expect(order()).toMatchObject({ status: "awaiting_payment" });
    expect(db.tables.zernio_logs).toHaveLength(0);
  });
});
