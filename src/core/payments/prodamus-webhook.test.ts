import { beforeEach, describe, expect, it, vi } from "vitest";
import { chargeRef, parsePhpForm, prodamusSign, type ProdamusConfig } from "./prodamus";

// Уведомление /api/prodamus/<bot>: подпись и сумму сверяет маршрут, поэтому
// тест идёт через его обработчик, а арендатор, заказ и отметка оплаты подменены.
const BOT = "b41a34cb-7944-441b-8f71-503184fc0f1f";
const CFG: ProdamusConfig = {
  formUrl: "https://shop.payform.ru",
  secretKey: "key",
  currency: "RUB",
  rate: 5.8,
};
/** Что ссылка передала в order_id: заказ и сумма к списанию в рублях. */
const ref = (orderId: number, rub: number, cfg = CFG) =>
  chargeRef(cfg, orderId, { amount: rub, currency: "RUB" });
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
let formCfg: ProdamusConfig = CFG;
let ready = true;

const resolvedIds: string[] = [];
vi.mock("@/core/tenant/resolve.server", () => ({
  resolveTenant: async ({ value }: { value: string }) => {
    resolvedIds.push(value);
    return { id: BOT, settings: { served_by: servedBy }, modules: {} };
  },
  tenantContext: (tenant: unknown) => ({ tenant, appUrl: "https://app.test" }),
}));
vi.mock("@/core/payments/payment", () => ({
  prodamusFor: async () => (ready ? { ready: true, ...formCfg } : { ready: false }),
  markPaidOnline,
  recordUnappliedPayment,
}));
vi.mock("@/core/orders/orders", () => ({
  getOrder: async (_ctx: unknown, id: number) =>
    id === 42
      ? { id, total: 1500, currency: "RUB", fulfillment_kind: "digital", display_no: 11 }
      : id === 43
        ? { id, total: 1500, currency: "KZT", fulfillment_kind: "digital", display_no: 12 }
        : id === 44
          ? { id, total: 490, currency: "RUB", fulfillment_kind: "digital", display_no: 13 }
          : null,
}));
vi.mock("@/channels/telegram/notify", () => ({ notifyAdminsHtml }));
const logEvent = vi.fn(async () => {});
vi.mock("@/app/operator/client-log.server", () => ({ logEvent }));
const traced = () =>
  (logEvent.mock.calls as unknown as Array<[string, string, Record<string, unknown>]>).map(
    ([, kind, p]) => `${kind}:${String(p.outcome)}`,
  );
vi.mock("@/app/payments/paid-online.server", () => ({ afterPaidOnline }));
vi.mock("@/lib/background", () => ({ runInBackground: (task: () => Promise<void>) => task() }));
vi.mock("@/core/fulfillment/fulfillment", () => ({
  amountDueNow: async (_ctx: unknown, o: { total: number }) => o.total,
}));

const { Route } = await import("@/routes/api/prodamus.$botId");
type Handler = (a: { request: Request; params: Record<string, string> }) => Promise<Response>;
const post = (Route.options as unknown as { server: { handlers: { POST: Handler } } }).server
  .handlers.POST;

function body(over: Record<string, string> = {}) {
  const f = {
    date: "2026-10-07T20:00:00+03:00",
    order_id: "9001",
    order_num: ref(42, 1500),
    sum: "1500.00",
    currency: "rub",
    payment_status: "success",
    "products[0][name]": "Заказ #11",
    "products[0][price]": "1500.00",
    "products[0][quantity]": "1",
    ...over,
  };
  return new URLSearchParams(f).toString();
}

function call(raw: string, key = "key", botId = BOT) {
  const request = new Request(`https://app.test/api/prodamus/${botId}`, {
    method: "POST",
    body: raw,
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      sign: prodamusSign(parsePhpForm(raw), key),
    },
  });
  return post({ request, params: { botId } });
}

beforeEach(() => {
  vi.clearAllMocks();
  servedBy = "v2";
  formCfg = CFG;
  ready = true;
  firstDelivery = true;
  markPaidOnline.mockResolvedValue({ ok: true, kind: "digital", alreadyDone: false });
});

describe("уведомление Продамуса", () => {
  it("успешная оплата на сумму заказа отмечает оплату и выдаёт заказ", async () => {
    const res = await call(body());
    expect(res.status).toBe(200);
    expect(markPaidOnline).toHaveBeenCalledWith(expect.anything(), 42, 1500, "Продамус", "9001");
    expect(afterPaidOnline).toHaveBeenCalledOnce();
  });

  it("заказ в тенге оплачен рублями по курсу на момент ссылки: оплата в тенге, в журнале — рубли", async () => {
    const res = await call(body({ order_num: ref(43, 259), sum: "259.00" }));
    expect(res.status).toBe(200);
    expect(markPaidOnline).toHaveBeenCalledWith(
      expect.anything(),
      43,
      1500,
      "Продамус",
      "9001, 259 RUB",
    );
    expect(afterPaidOnline).toHaveBeenCalledOnce();
  });

  it("форма в тенге, оплата картой РФ: sum в тенге и currency=rub — заказ оплачен, в журнале «картой RUB»", async () => {
    // Копилка русоведа 09.10, платёж 511523: заказ #17 на 150 ₸, покупатель списал 41,98 ₽.
    formCfg = { ...CFG, currency: "KZT" };
    const kzt = chargeRef(formCfg, 43, { amount: 1500, currency: "KZT" });
    const res = await call(body({ order_id: "511523", order_num: kzt, sum: "1500.00" }));
    expect(res.status).toBe(200);
    expect(recordUnappliedPayment).not.toHaveBeenCalled();
    expect(markPaidOnline).toHaveBeenCalledWith(
      expect.anything(),
      43,
      1500,
      "Продамус",
      "511523, картой RUB",
    );
    expect(afterPaidOnline).toHaveBeenCalledOnce();
    expect(traced()).toEqual(["payment:paid"]);
  });

  it("заказ в рублях через форму в тенге: 1751 ₸ по ссылке — заказ на 490 ₽ оплачен, в журнале тенге и карта", async () => {
    formCfg = { ...CFG, currency: "KZT", rate: 3.573 };
    const kzt = chargeRef(formCfg, 44, { amount: 1751, currency: "KZT" });
    await call(body({ order_id: "511700", order_num: kzt, sum: "1751.00", currency: "rub" }));
    expect(recordUnappliedPayment).not.toHaveBeenCalled();
    expect(markPaidOnline).toHaveBeenCalledWith(
      expect.anything(),
      44,
      490,
      "Продамус",
      "511700, 1751 KZT, картой RUB",
    );
  });

  it("форма в тенге, Продамус списал не ту сумму — заказ оплачен по «success», списанное в журнале", async () => {
    formCfg = { ...CFG, currency: "KZT" };
    const kzt = chargeRef(formCfg, 43, { amount: 1500, currency: "KZT" });
    await call(body({ order_id: "511524", order_num: kzt, sum: "41.98" }));
    expect(recordUnappliedPayment).not.toHaveBeenCalled();
    expect(markPaidOnline).toHaveBeenCalledWith(
      expect.anything(),
      43,
      1500,
      "Продамус",
      "511524, картой RUB, списано 41.98 KZT",
    );
  });

  it("сумму в ссылке подменили — подпись order_id не сходится, заказ не трогается", async () => {
    const forged = ref(43, 259).replace("-25900-", "-100-");
    const res = await call(body({ order_num: forged, sum: "1.00" }));
    expect(res.status).toBe(200);
    expect(traced()).toEqual(["payment:not_our_order"]);
    expect(markPaidOnline).not.toHaveBeenCalled();
    expect(recordUnappliedPayment).not.toHaveBeenCalled();
  });

  it("повтор уведомления — заказ уже оплачен, вторая выдача не запускается", async () => {
    await call(body());
    markPaidOnline.mockResolvedValue({ ok: true, kind: "digital", alreadyDone: true });
    await call(body());
    expect(markPaidOnline).toHaveBeenCalledTimes(2);
    expect(afterPaidOnline).toHaveBeenCalledOnce();
  });

  it("чужая подпись — 400, заказ не трогается", async () => {
    const res = await call(body(), "other");
    expect(res.status).toBe(400);
    expect(markPaidOnline).not.toHaveBeenCalled();
  });

  it("каждое уведомление — в журнал клиента с исходом, без подписи и ключа", async () => {
    await call(body(), "other");
    await call(body({ order_num: "123" }));
    await call(body({ payment_status: "order_canceled" }));
    await call(body());
    expect(traced()).toEqual([
      "payment:bad_sign",
      "payment:not_our_order",
      "payment:not_success",
      "payment:paid",
    ]);
    const payload = (
      logEvent.mock.calls.at(-1) as unknown as [string, string, Record<string, unknown>]
    )[2];
    expect(payload).toMatchObject({
      provider: "prodamus",
      order: 42,
      sum: "1500.00",
      order_id: "9001",
    });
    expect(JSON.stringify(logEvent.mock.calls)).not.toContain("key");
  });

  it("сумма другая, но Продамус ответил «прошло» — заказ оплачен, без предупреждения, сумма в журнале", async () => {
    const res = await call(body({ sum: "15.00" }));
    expect(res.status).toBe(200);
    expect(markPaidOnline).toHaveBeenCalledWith(
      expect.anything(),
      42,
      1500,
      "Продамус",
      "9001, списано 15.00 RUB",
    );
    expect(afterPaidOnline).toHaveBeenCalledOnce();
    expect(recordUnappliedPayment).not.toHaveBeenCalled();
    expect(notifyAdminsHtml).not.toHaveBeenCalled();
    expect(traced()).toEqual(["payment:paid"]);
  });

  it("оплата по закрытому заказу — событие в журнал и одно уведомление", async () => {
    markPaidOnline.mockResolvedValue({
      ok: true,
      kind: "digital",
      alreadyDone: true,
      closed: true,
      status: "cancelled",
    });
    await call(body());
    expect(afterPaidOnline).not.toHaveBeenCalled();
    expect(recordUnappliedPayment).toHaveBeenCalledWith(
      expect.anything(),
      42,
      "payment_on_closed",
      { amount: 1500, currency: "RUB", provider: "Продамус", ref: "9001", status: "cancelled" },
    );
    firstDelivery = false;
    await call(body());
    expect(notifyAdminsHtml).toHaveBeenCalledOnce();
  });

  it("неуспешный статус и чужой заказ — 200 без действий", async () => {
    expect((await call(body({ payment_status: "order_canceled" }))).status).toBe(200);
    await call(body({ order_num: ref(999, 1500) }));
    await call(body({ order_num: "42" }));
    expect(markPaidOnline).not.toHaveBeenCalled();
  });

  it("адрес вставлен с точкой или пробелом в конце — уведомление принимается (Копилка 09.10)", async () => {
    for (const id of [`${BOT}.`, `${BOT}. `, `${BOT}%20`, `${BOT}/`]) {
      resolvedIds.length = 0;
      markPaidOnline.mockClear();
      const res = await call(body(), "key", id);
      expect(res.status).toBe(200);
      expect(resolvedIds).toEqual([BOT]);
      expect(markPaidOnline).toHaveBeenCalledWith(expect.anything(), 42, 1500, "Продамус", "9001");
    }
    expect((await call(body(), "key", `${BOT}x`)).status).toBe(404);
    expect((await call(body(), "key", "not-a-bot")).status).toBe(404);
  });

  it("клиент прежней платформы и выключенный Продамус — не принимаются", async () => {
    servedBy = "v1";
    expect((await call(body())).status).toBe(404);
    servedBy = "v2";
    ready = false;
    expect((await call(body())).status).toBe(403);
    expect(markPaidOnline).not.toHaveBeenCalled();
  });
});
