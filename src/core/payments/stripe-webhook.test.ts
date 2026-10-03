import { beforeEach, describe, expect, it, vi } from "vitest";
import { stripeSignature } from "./stripe";

// Вебхук /api/stripe/<bot>: подпись и сумму сверяет маршрут, поэтому тест
// идёт через его обработчик, а арендатор, заказ и отметка оплаты подменены.
const BOT = "b41a34cb-7944-441b-8f71-503184fc0f1f";
const markPaidOnline = vi.fn(async (): Promise<Record<string, unknown>> => ({
  ok: true,
  kind: "digital",
  alreadyDone: false,
}));
let firstDelivery = true;
const recordUnappliedPayment = vi.fn(async () => firstDelivery);
const afterPaidOnline = vi.fn(async () => {});
const notifyAdminsHtml = vi.fn(async () => 1);
let servedBy = "v2";
let ready = true;

vi.mock("@/core/tenant/resolve.server", () => ({
  resolveTenant: async () => ({ id: BOT, settings: { served_by: servedBy }, modules: {} }),
  tenantContext: (tenant: unknown) => ({ tenant, appUrl: "https://app.test" }),
}));
vi.mock("@/core/payments/payment", () => ({
  stripeFor: async () =>
    ready ? { ready: true, secretKey: "sk", webhookSecret: "whsec" } : { ready: false },
  markPaidOnline,
  recordUnappliedPayment,
}));
vi.mock("@/core/orders/orders", () => ({
  getOrder: async (_ctx: unknown, id: number) =>
    id === 42
      ? { id, total: 12000, currency: "KZT", fulfillment_kind: "digital", display_no: 7 }
      : null,
}));
vi.mock("@/channels/telegram/notify", () => ({ notifyAdminsHtml }));
vi.mock("@/app/payments/paid-online.server", () => ({ afterPaidOnline }));
vi.mock("@/lib/background", () => ({ runInBackground: (task: () => Promise<void>) => task() }));
vi.mock("@/core/fulfillment/fulfillment", () => ({
  amountDueNow: async (_ctx: unknown, o: { total: number }) => o.total,
}));

const { Route } = await import("@/routes/api/stripe.$botId");
type Handler = (a: { request: Request; params: Record<string, string> }) => Promise<Response>;
const post = (Route.options as unknown as { server: { handlers: { POST: Handler } } }).server
  .handlers.POST;

function event(over: Record<string, unknown> = {}) {
  return {
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
  };
}

function call(body: unknown, secret = "whsec") {
  const raw = JSON.stringify(body);
  const t = Math.floor(Date.now() / 1000);
  const request = new Request(`https://app.test/api/stripe/${BOT}`, {
    method: "POST",
    body: raw,
    headers: { "stripe-signature": `t=${t},v1=${stripeSignature(raw, t, secret)}` },
  });
  return post({ request, params: { botId: BOT } });
}

beforeEach(() => {
  vi.clearAllMocks();
  servedBy = "v2";
  ready = true;
});

describe("вебхук Stripe", () => {
  it("оплаченная сессия на сумму заказа отмечает оплату и выдаёт заказ", async () => {
    const res = await call(event());
    expect(res.status).toBe(200);
    expect(markPaidOnline).toHaveBeenCalledWith(expect.anything(), 42, 12000, "Stripe", "pi_1");
    expect(afterPaidOnline).toHaveBeenCalledOnce();
  });

  it("чужая подпись — 400, заказ не трогается", async () => {
    const res = await call(event(), "other");
    expect(res.status).toBe(400);
    expect(markPaidOnline).not.toHaveBeenCalled();
  });

  beforeEach(() => {
    firstDelivery = true;
    recordUnappliedPayment.mockClear();
    markPaidOnline.mockReset();
    markPaidOnline.mockResolvedValue({ ok: true, kind: "digital", alreadyDone: false });
    notifyAdminsHtml.mockClear();
    afterPaidOnline.mockClear();
  });

  it("сумма не сошлась — продавцу предупреждение, заказ не подтверждён", async () => {
    const res = await call(event({ amount_total: 100 }));
    expect(res.status).toBe(200);
    expect(markPaidOnline).not.toHaveBeenCalled();
    expect(notifyAdminsHtml).toHaveBeenCalledOnce();
    // Платёж остаётся в журнале заказа: то, что списал Stripe (1 ₸ = 100 минимальных единиц).
    expect(recordUnappliedPayment).toHaveBeenCalledWith(expect.anything(), 42, "payment_mismatch", {
      amount: 1,
      currency: "KZT",
      provider: "Stripe",
      ref: "pi_1",
    });
  });

  it("оплата по закрытому заказу — событие в журнал и одно уведомление, повтор колбэка тихий", async () => {
    markPaidOnline.mockResolvedValue({
      ok: true,
      kind: "digital",
      alreadyDone: true,
      closed: true,
      status: "rejected",
    });
    await call(event());
    expect(afterPaidOnline).not.toHaveBeenCalled();
    expect(recordUnappliedPayment).toHaveBeenCalledWith(
      expect.anything(),
      42,
      "payment_on_closed",
      {
        amount: 12000,
        currency: "KZT",
        provider: "Stripe",
        ref: "pi_1",
        status: "rejected",
      },
    );
    expect(notifyAdminsHtml).toHaveBeenCalledOnce();
    firstDelivery = false;
    await call(event());
    expect(notifyAdminsHtml).toHaveBeenCalledOnce();
  });

  it("неоплаченная сессия и чужие события — 200 без действий", async () => {
    await call(event({ payment_status: "unpaid" }));
    await call({ ...event(), type: "customer.created" });
    await call(event({ metadata: { bot_id: "другой" } }));
    await call(event({ client_reference_id: "999", metadata: {} }));
    expect(markPaidOnline).not.toHaveBeenCalled();
  });

  it("клиент прежней платформы и выключенный Stripe — не принимаются", async () => {
    servedBy = "v1";
    expect((await call(event())).status).toBe(404);
    servedBy = "v2";
    ready = false;
    expect((await call(event())).status).toBe(403);
    expect(markPaidOnline).not.toHaveBeenCalled();
  });
});
