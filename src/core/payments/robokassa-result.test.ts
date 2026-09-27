import { beforeEach, describe, expect, it, vi } from "vitest";
import { md5Hex } from "./robokassa";

// Колбэк result маршрута /api/robokassa/<bot>/result: подпись и сумму
// сверяет он сам, поэтому тест идёт через обработчик маршрута, а база,
// арендатор и отметка оплаты подменены.
const BOT = "b41a34cb-7944-441b-8f71-503184fc0f1f";
const markPaidOnline = vi.fn(async () => ({ ok: true, kind: "digital", alreadyDone: true }));
const afterPaidOnline = vi.fn(async () => {});
let platform = "telegram";
let status = "awaiting_payment";
const notifyAdminsHtml = vi.fn(async () => 1);

vi.mock("@/core/tenant/resolve.server", () => ({
  resolveTenant: async () => ({
    id: BOT,
    settings: { served_by: "v2", slug: "shop", telegram: { username: "shop_bot" } },
    modules: {},
  }),
  tenantContext: (tenant: unknown) => ({ tenant, appUrl: "https://app.test" }),
}));
vi.mock("@/core/payments/payment", () => ({
  robokassaFor: async () => ({ ready: true, login: "shop", pass1: "p1", pass2: "p2" }),
  markPaidOnline,
}));
vi.mock("@/core/orders/orders", () => ({
  getOrder: async (_ctx: unknown, id: number) => ({
    id,
    total: 1500,
    fulfillment_kind: "digital",
    platform,
    status,
    display_no: 7,
  }),
}));
vi.mock("@/channels/telegram/notify", () => ({ notifyAdminsHtml }));
vi.mock("@/app/payments/paid-online.server", () => ({ afterPaidOnline }));
vi.mock("@/lib/background", () => ({ runInBackground: (task: () => Promise<void>) => task() }));
vi.mock("@/config/env", () => ({ env: () => ({ SESSION_SECRET: "s".repeat(40) }) }));
type BalanceRes = Awaited<
  ReturnType<typeof import("@/core/orders/balance").recordBalancePaidOnline>
>;
const recordBalancePaidOnline = vi.fn(async (): Promise<BalanceRes> => ({ result: "recorded" }));
const notifyBalancePaid = vi.fn(async () => ({ notified: true }));
vi.mock("@/app/admin/balance.server", () => ({ notifyBalancePaid }));
vi.mock("@/core/orders/balance", async (orig) => ({
  ...(await orig<typeof import("@/core/orders/balance")>()),
  recordBalancePaidOnline,
}));
vi.mock("@/core/fulfillment/fulfillment", () => ({
  amountDueNow: async (_ctx: unknown, o: { total: number }) => o.total,
}));

const { Route } = await import("@/routes/api/robokassa.$botId.$action");

type Handler = (a: { request: Request; params: Record<string, string> }) => Promise<Response>;
const handlers = () =>
  (Route.options as unknown as { server: { handlers: { GET: Handler; POST: Handler } } }).server
    .handlers;

function callReturn(action: "success" | "fail", q: Record<string, string>) {
  const request = new Request(
    `https://app.test/api/robokassa/${BOT}/${action}?${new URLSearchParams(q).toString()}`,
  );
  return handlers().GET({ request, params: { botId: BOT, action } });
}

function callResult(outSum: string, invId = "42") {
  const sig = md5Hex(`${outSum}:${invId}:p2:Shp_bot=${BOT}`).toUpperCase();
  const body = new URLSearchParams({
    OutSum: outSum,
    InvId: invId,
    SignatureValue: sig,
    Shp_bot: BOT,
  });
  const request = new Request(`https://app.test/api/robokassa/${BOT}/result`, {
    method: "POST",
    body: body.toString(),
  });
  const handlers = (
    Route.options as unknown as {
      server: {
        handlers: {
          POST: (a: { request: Request; params: Record<string, string> }) => Promise<Response>;
        };
      };
    }
  ).server.handlers;
  return handlers.POST({ request, params: { botId: BOT, action: "result" } });
}

describe("Robokassa result: сверка суммы", () => {
  beforeEach(() => markPaidOnline.mockClear());

  it("NaN от нечислового OutSum не считается прошедшей проверку суммы", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await callResult("не-число");
    expect(res.status).toBe(400);
    expect(await res.text()).toBe("amount mismatch");
    expect(markPaidOnline).not.toHaveBeenCalled();
  });

  it("сумма совпала с ожидаемой — заказ отмечается оплаченным", async () => {
    const res = await callResult("1500.00");
    expect(await res.text()).toBe("OK42");
    expect(markPaidOnline).toHaveBeenCalledWith(
      expect.anything(),
      42,
      1500,
      "Robokassa",
      expect.any(String),
    );
  });
});

describe("Robokassa: заказ с сайта", () => {
  beforeEach(() => {
    platform = "telegram";
    afterPaidOnline.mockClear();
    markPaidOnline.mockClear();
  });

  it("оплата подтверждена — выдача по каналу заказа, не только в Telegram", async () => {
    platform = "web";
    markPaidOnline.mockResolvedValueOnce({ ok: true, kind: "digital", alreadyDone: false });
    expect(await (await callResult("1500.00")).text()).toBe("OK42");
    expect(afterPaidOnline).toHaveBeenCalledWith(expect.anything(), 42);
  });

  it("успех с верной подписью — на страницу заказа с подписанной ссылкой", async () => {
    platform = "web";
    const sig = md5Hex(`1500.00:42:p1:Shp_bot=${BOT}`).toUpperCase();
    const res = await callReturn("success", {
      OutSum: "1500.00",
      InvId: "42",
      SignatureValue: sig,
      Shp_bot: BOT,
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toMatch(
      /^https:\/\/app\.test\/s\/shop\/order\/42\?t=[0-9a-f]{32}$/,
    );
  });

  it("успех с чужой подписью — страница заказа без ссылки доступа", async () => {
    platform = "web";
    const res = await callReturn("success", {
      OutSum: "1500.00",
      InvId: "42",
      SignatureValue: "0".repeat(32),
      Shp_bot: BOT,
    });
    expect(res.headers.get("location")).toBe("https://app.test/s/shop/order/42");
  });

  it("отказ — на страницу заказа без ссылки: её хранит браузер покупателя", async () => {
    platform = "web";
    const res = await callReturn("fail", { OutSum: "1500.00", InvId: "42", Shp_bot: BOT });
    expect(res.headers.get("location")).toBe("https://app.test/s/shop/order/42");
  });

  it("заказ из бота — как раньше, страница «вернуться в бота»", async () => {
    const res = await callReturn("success", { OutSum: "1500.00", InvId: "42" });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("https://t.me/shop_bot");
  });

  it("оплата пришла по отменённому неоплаченным заказу — продавцу срочно, заказ не трогаем", async () => {
    platform = "web";
    status = "rejected";
    markPaidOnline.mockResolvedValueOnce({ ok: true, kind: "digital", alreadyDone: true });
    expect(await (await callResult("1500.00")).text()).toBe("OK42");
    expect(afterPaidOnline).not.toHaveBeenCalled();
    expect(notifyAdminsHtml).toHaveBeenCalledTimes(1);
    status = "awaiting_payment";
  });
});

describe("Robokassa: оплата остатка по задатку", () => {
  const INV = "1000000000420001";
  beforeEach(() => {
    platform = "web";
    status = "in_production";
    markPaidOnline.mockClear();
    afterPaidOnline.mockClear();
    notifyAdminsHtml.mockClear();
    recordBalancePaidOnline.mockClear();
    notifyBalancePaid.mockClear();
  });

  it("остаток записан к заказу 42, продавцу — сообщение; заказ не «оплачивается заново»", async () => {
    expect(await (await callResult("1050.00", INV)).text()).toBe(`OK${INV}`);
    expect(recordBalancePaidOnline).toHaveBeenCalledWith(
      expect.anything(),
      42,
      1050,
      "Robokassa",
      INV,
    );
    expect(markPaidOnline).not.toHaveBeenCalled();
    expect(afterPaidOnline).not.toHaveBeenCalled();
    expect(notifyAdminsHtml).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining("Остаток"),
      expect.objectContaining({ orderId: 42 }),
    );
    // Покупателю — «остаток получен» в его канал.
    expect(notifyBalancePaid).toHaveBeenCalledWith(expect.anything(), 42, 1050);
  });

  it("повтор колбэка — OK без второго сообщения", async () => {
    recordBalancePaidOnline.mockResolvedValueOnce({ result: "duplicate" });
    expect(await (await callResult("1050.00", INV)).text()).toBe(`OK${INV}`);
    expect(notifyAdminsHtml).not.toHaveBeenCalled();
  });

  it("переплата — деньги пришли, не записаны: продавцу срочно вернуть разницу", async () => {
    recordBalancePaidOnline.mockResolvedValueOnce({ result: "refused" });
    expect(await (await callResult("1050.00", INV)).text()).toBe(`OK${INV}`);
    expect(notifyBalancePaid).not.toHaveBeenCalled();
    expect(notifyAdminsHtml).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining("верните"),
      expect.objectContaining({ kind: "delivery_failure" }),
    );
  });

  it("оплата по отменённому заказу — продавцу: выполнить заказ или вернуть деньги", async () => {
    recordBalancePaidOnline.mockResolvedValueOnce({ result: "closed" });
    expect(await (await callResult("1050.00", INV)).text()).toBe(`OK${INV}`);
    expect(notifyAdminsHtml).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringMatching(/счёт Robokassa №\d+\).*отменённому заказу/),
      expect.objectContaining({ kind: "delivery_failure" }),
    );
  });

  it("чек на остаток ждал продавца — в сообщении: чек не вносить", async () => {
    recordBalancePaidOnline.mockResolvedValueOnce({ result: "recorded", proofPending: true });
    await callResult("1050.00", INV);
    expect(notifyAdminsHtml).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining("в заказ не вносите"),
      expect.anything(),
    );
  });

  it("метка не записалась — 500, Robokassa повторит колбэк", async () => {
    recordBalancePaidOnline.mockResolvedValueOnce({ result: "retry" });
    expect((await callResult("1050.00", INV)).status).toBe(500);
    expect(notifyAdminsHtml).not.toHaveBeenCalled();
  });

  it("мусорный InvId и нечисловая сумма — 400, ничего не пишем", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await callResult("1050.00", "1000000000009999")).status).toBe(400);
    expect((await callResult("abc", INV)).status).toBe(400);
    expect(recordBalancePaidOnline).not.toHaveBeenCalled();
  });

  it("возврат покупателя после оплаты остатка — на страницу того же заказа", async () => {
    const sig = md5Hex(`1050.00:${INV}:p1:Shp_bot=${BOT}`).toUpperCase();
    const res = await callReturn("success", {
      OutSum: "1050.00",
      InvId: INV,
      SignatureValue: sig,
      Shp_bot: BOT,
    });
    expect(res.headers.get("location")).toMatch(
      /^https:\/\/app\.test\/s\/shop\/order\/42\?t=[0-9a-f]{32}$/,
    );
  });
});
