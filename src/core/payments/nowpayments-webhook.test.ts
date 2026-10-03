import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";

// Вебхук /api/nowpayments/<bot>: подпись и сумму сверяет маршрут; арендатор,
// заказ и отметка оплаты подменены, журнал и уведомление — настоящие границы.
const BOT = "b41a34cb-7944-441b-8f71-503184fc0f1f";
const markPaidOnline = vi.fn(async (): Promise<Record<string, unknown>> => ({
  ok: true,
  kind: "digital",
  alreadyDone: false,
}));
let firstDelivery = true;
const recordUnappliedPayment = vi.fn(async (..._a: unknown[]) => firstDelivery);
const afterPaidOnline = vi.fn(async () => {});
const notifyAdminsHtml = vi.fn(async (..._a: unknown[]) => 1);

vi.mock("@/core/tenant/resolve.server", () => ({
  resolveTenant: async () => ({ id: BOT, settings: { served_by: "v2" }, modules: {} }),
  tenantContext: (tenant: unknown) => ({ tenant, appUrl: "https://app.test" }),
}));
vi.mock("@/core/payments/payment", () => ({
  nowpaymentsFor: async () => ({ ready: true, ipnSecret: "secret" }),
  markPaidOnline,
  recordUnappliedPayment,
}));
vi.mock("@/core/orders/orders", () => ({
  getOrder: async (_c: unknown, id: number) => ({
    id,
    total: 50,
    currency: "USD",
    fulfillment_kind: "digital",
    display_no: 7,
  }),
}));
vi.mock("@/channels/telegram/notify", () => ({ notifyAdminsHtml }));
vi.mock("@/app/payments/paid-online.server", () => ({ afterPaidOnline }));
vi.mock("@/lib/background", () => ({ runInBackground: (t: () => Promise<void>) => t() }));
vi.mock("@/core/fulfillment/fulfillment", () => ({
  amountDueNow: async (_c: unknown, o: { total: number }) => o.total,
}));

const { Route } = await import("@/routes/api/nowpayments.$botId");
type Handler = (a: { request: Request; params: Record<string, string> }) => Promise<Response>;
const post = (Route.options as unknown as { server: { handlers: { POST: Handler } } }).server
  .handlers.POST;

// NOWPayments подписывает JSON с ключами по алфавиту.
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

beforeEach(() => {
  firstDelivery = true;
  recordUnappliedPayment.mockClear();
  notifyAdminsHtml.mockClear();
  afterPaidOnline.mockClear();
  markPaidOnline.mockReset();
  markPaidOnline.mockResolvedValue({ ok: true, kind: "digital", alreadyDone: false });
});

describe("вебхук NOWPayments", () => {
  it("оплата по закрытому заказу — событие payment_on_closed и одно уведомление", async () => {
    markPaidOnline.mockResolvedValue({
      ok: true,
      kind: "digital",
      alreadyDone: true,
      closed: true,
      status: "cancelled",
    });
    expect((await call(ipn())).status).toBe(200);
    expect(recordUnappliedPayment).toHaveBeenCalledWith(
      expect.anything(),
      42,
      "payment_on_closed",
      {
        amount: 50,
        currency: "USD",
        provider: "NOWPayments",
        ref: "555",
        status: "cancelled",
      },
    );
    expect(notifyAdminsHtml).toHaveBeenCalledTimes(1);
    expect(afterPaidOnline).not.toHaveBeenCalled();
    firstDelivery = false;
    await call(ipn());
    expect(notifyAdminsHtml).toHaveBeenCalledTimes(1);
  });

  it("не полная оплата и чужая сумма — payment_mismatch, заказ не подтверждён", async () => {
    await call(ipn({ payment_status: "partially_paid" }));
    await call(ipn({ price_amount: 5 }));
    expect(markPaidOnline).not.toHaveBeenCalled();
    expect(recordUnappliedPayment.mock.calls.map((c) => c[2])).toEqual([
      "payment_mismatch",
      "payment_mismatch",
    ]);
    expect(recordUnappliedPayment.mock.calls[1]![3]).toMatchObject({ amount: 5, currency: "USD" });
    expect(notifyAdminsHtml).toHaveBeenCalledTimes(2);
  });
});
