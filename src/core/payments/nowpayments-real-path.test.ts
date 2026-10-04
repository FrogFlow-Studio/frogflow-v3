import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";

/**
 * Вебхук NOWPayments по настоящему пути оплаты (E3): маршрут, `getOrder`,
 * `markPaidOnline`, журнал заказа и `reportUnappliedPayment` — настоящие,
 * на подставной базе. Подменены только граница арендатора, настройки
 * шлюза, Telegram и фон. В отличие от nowpayments-webhook.test.ts, который
 * считает вызовы заглушек, здесь результат виден в заказе и в журнале.
 */
const BOT = "b41a34cb-7944-441b-8f71-503184fc0f1f";
let db: FakeDb;
const notifyAdminsHtml = vi.fn(async (..._a: unknown[]) => 1);
const afterPaidOnline = vi.fn(async (..._a: unknown[]) => {});

vi.mock("@/core/tenant/resolve.server", () => ({
  resolveTenant: async () => ({ id: BOT, settings: { served_by: "v2" }, modules: {} }),
  tenantContext: (tenant: unknown) => ({ tenant, db, appUrl: "https://app.test" }),
}));
vi.mock("@/core/settings/settings", () => ({ getSettings: async () => ({}) }));
vi.mock("@/core/payments/payment", async (orig) => {
  const real = await orig<typeof import("@/core/payments/payment")>();
  return { ...real, nowpaymentsFor: async () => ({ ready: true, ipnSecret: "secret" }) };
});
vi.mock("@/channels/telegram/notify", () => ({ notifyAdminsHtml }));
vi.mock("@/app/payments/paid-online.server", () => ({ afterPaidOnline }));
vi.mock("@/lib/background", () => ({ runInBackground: (t: () => Promise<void>) => t() }));

const { Route } = await import("@/routes/api/nowpayments.$botId");
type Handler = (a: { request: Request; params: Record<string, string> }) => Promise<Response>;
const post = (Route.options as unknown as { server: { handlers: { POST: Handler } } }).server
  .handlers.POST;

function call(ipn: Record<string, unknown>) {
  const sorted = Object.fromEntries(Object.entries(ipn).sort(([a], [b]) => a.localeCompare(b)));
  const raw = JSON.stringify(sorted);
  const sig = createHmac("sha512", "secret").update(raw).digest("hex");
  return post({
    request: new Request(`https://app.test/api/nowpayments/${BOT}`, {
      method: "POST",
      body: raw,
      headers: { "x-nowpayments-sig": sig },
    }),
    params: { botId: BOT },
  });
}
const ipn = (over: Record<string, unknown> = {}) => ({
  payment_id: 555,
  payment_status: "finished",
  order_id: "42",
  price_amount: 50,
  price_currency: "usd",
  ...over,
});
const order = () => db.tables.orders!.find((o) => o.id === 42)!;
const events = (type: string) => db.tables.zernio_logs!.filter((e) => e.event_type === type);

beforeEach(() => {
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
      total: 50,
      currency: "USD",
    },
  ];
  db.tables.zernio_logs = [];
});

describe("вебхук NOWPayments: настоящий путь оплаты", () => {
  it("полная оплата — заказ оплачен на сумму, платёж с номером в журнале, повтор ничего не дублирует", async () => {
    expect((await call(ipn())).status).toBe(200);
    expect(order()).toMatchObject({ status: "paid", paid_amount: 50 });
    expect(events("order.payment")).toHaveLength(1);
    expect(events("order.payment")[0]!.payload).toMatchObject({
      order_id: 42,
      amount: 50,
      provider: "NOWPayments",
      invId: "555",
    });
    expect(afterPaidOnline).toHaveBeenCalledTimes(1);
    await call(ipn());
    expect(events("order.payment")).toHaveLength(1);
    expect(afterPaidOnline).toHaveBeenCalledTimes(1);
  });

  it("не полная оплата и чужая сумма — заказ не оплачен, обе суммы с номером платежа видны в журнале", async () => {
    await call(ipn({ payment_status: "partially_paid" }));
    await call(ipn({ price_amount: 5, payment_id: 556 }));
    expect(order()).toMatchObject({ status: "awaiting_payment", paid_amount: 0 });
    expect(events("order.payment")).toHaveLength(0);
    const mismatch = events("order.payment_mismatch");
    expect(mismatch).toHaveLength(2);
    expect(mismatch.map((e) => (e.payload as Record<string, unknown>).invId).sort()).toEqual([
      "555",
      "556",
    ]);
    expect(mismatch.map((e) => (e.payload as Record<string, unknown>).amount).sort()).toEqual([
      5, 50,
    ]);
    expect(afterPaidOnline).not.toHaveBeenCalled();
  });

  it("оплата по отменённому заказу — статус не меняется, платёж в журнале с суммой и номером, одно уведомление", async () => {
    order().status = "cancelled";
    expect((await call(ipn())).status).toBe(200);
    expect(order()).toMatchObject({ status: "cancelled", paid_amount: 0 });
    expect(events("order.payment")).toHaveLength(0);
    const closed = events("order.payment_on_closed");
    expect(closed).toHaveLength(1);
    expect(closed[0]!.payload).toMatchObject({ amount: 50, invId: "555", status: "cancelled" });
    await call(ipn());
    expect(events("order.payment_on_closed")).toHaveLength(1);
    expect(notifyAdminsHtml).toHaveBeenCalledTimes(1);
    expect(afterPaidOnline).not.toHaveBeenCalled();
  });
});
