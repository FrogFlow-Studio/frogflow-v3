import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import { stripeSignature } from "./stripe";

/**
 * Вебхук Stripe по настоящему пути оплаты (E3): маршрут, `getOrder`,
 * `markPaidOnline`, журнал заказа и `reportUnappliedPayment` настоящие, на
 * подставной базе; подменены граница арендатора, ключи шлюза, Telegram и
 * фон. Результат виден в заказе и в журнале, а не в вызовах заглушек.
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
  return {
    ...real,
    stripeFor: async () => ({ ready: true, secretKey: "sk", webhookSecret: "whsec" }),
  };
});
vi.mock("@/channels/telegram/notify", () => ({ notifyAdminsHtml }));
vi.mock("@/app/payments/paid-online.server", () => ({ afterPaidOnline }));
vi.mock("@/lib/background", () => ({ runInBackground: (t: () => Promise<void>) => t() }));

const { Route } = await import("@/routes/api/stripe.$botId");
type Handler = (a: { request: Request; params: Record<string, string> }) => Promise<Response>;
const post = (Route.options as unknown as { server: { handlers: { POST: Handler } } }).server
  .handlers.POST;

const event = (over: Record<string, unknown> = {}) => ({
  id: "evt_1",
  type: "checkout.session.completed",
  data: {
    object: {
      id: "cs_1",
      object: "checkout.session",
      payment_status: "paid",
      amount_total: 1_200_000,
      currency: "kzt",
      client_reference_id: "42",
      payment_intent: "pi_1",
      metadata: { order_id: "42", bot_id: BOT },
      ...over,
    },
  },
});
function call(body: unknown) {
  const raw = JSON.stringify(body);
  const t = Math.floor(Date.now() / 1000);
  return post({
    request: new Request(`https://app.test/api/stripe/${BOT}`, {
      method: "POST",
      body: raw,
      headers: { "stripe-signature": `t=${t},v1=${stripeSignature(raw, t, "whsec")}` },
    }),
    params: { botId: BOT },
  });
}
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
      total: 12000,
      currency: "KZT",
    },
  ];
  db.tables.zernio_logs = [];
});

describe("вебхук Stripe: настоящий путь оплаты", () => {
  it("оплаченная сессия — заказ оплачен на сумму, платёж с номером в журнале, повтор не дублирует", async () => {
    expect((await call(event())).status).toBe(200);
    expect(order()).toMatchObject({ status: "paid", paid_amount: 12000 });
    expect(events("order.payment")).toHaveLength(1);
    expect(events("order.payment")[0]!.payload).toMatchObject({
      order_id: 42,
      amount: 12000,
      provider: "Stripe",
      invId: "pi_1",
    });
    await call(event());
    expect(events("order.payment")).toHaveLength(1);
    expect(afterPaidOnline).toHaveBeenCalledTimes(1);
  });

  it("оплата по отклонённому заказу — статус не меняется, платёж в журнале с суммой и номером, одно уведомление", async () => {
    order().status = "rejected";
    await call(event());
    expect(order()).toMatchObject({ status: "rejected", paid_amount: 0 });
    expect(events("order.payment")).toHaveLength(0);
    const closed = events("order.payment_on_closed");
    expect(closed).toHaveLength(1);
    expect(closed[0]!.payload).toMatchObject({ amount: 12000, invId: "pi_1", status: "rejected" });
    await call(event());
    expect(events("order.payment_on_closed")).toHaveLength(1);
    expect(notifyAdminsHtml).toHaveBeenCalledTimes(1);
    expect(afterPaidOnline).not.toHaveBeenCalled();
  });

  it("неоплаченная сессия и чужие события — заказ и журнал не тронуты", async () => {
    await call(event({ payment_status: "unpaid" }));
    await call({ ...event(), type: "customer.created" });
    await call(event({ metadata: { bot_id: "другой" } }));
    await call(event({ client_reference_id: "999", metadata: {} }));
    expect(order()).toMatchObject({ status: "awaiting_payment", paid_amount: 0 });
    expect(db.tables.zernio_logs).toHaveLength(0);
    expect(afterPaidOnline).not.toHaveBeenCalled();
  });

  it("сумма сессии не совпала с заказом — заказ не оплачен, расхождение видно в журнале", async () => {
    await call(event({ amount_total: 500_000 }));
    expect(order()).toMatchObject({ status: "awaiting_payment", paid_amount: 0 });
    expect(events("order.payment")).toHaveLength(0);
    expect(events("order.payment_mismatch")).toHaveLength(1);
    expect(events("order.payment_mismatch")[0]!.payload).toMatchObject({
      amount: 5000,
      invId: "pi_1",
    });
  });
});
