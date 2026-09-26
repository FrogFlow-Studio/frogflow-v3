import { beforeEach, describe, expect, it, vi } from "vitest";
import { md5Hex } from "./robokassa";

// Колбэк result маршрута /api/robokassa/<bot>/result: подпись и сумму
// сверяет он сам, поэтому тест идёт через обработчик маршрута, а база,
// арендатор и отметка оплаты подменены.
const BOT = "b41a34cb-7944-441b-8f71-503184fc0f1f";
const markPaidOnline = vi.fn(async () => ({ ok: true, kind: "digital", alreadyDone: true }));

vi.mock("@/core/tenant/resolve.server", () => ({
  resolveTenant: async () => ({ id: BOT, settings: { served_by: "v2" }, modules: {} }),
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
    platform: "telegram",
  }),
}));
vi.mock("@/core/fulfillment/fulfillment", () => ({
  amountDueNow: async (_ctx: unknown, o: { total: number }) => o.total,
}));

const { Route } = await import("@/routes/api/robokassa.$botId.$action");

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
    expect(markPaidOnline).toHaveBeenCalledWith(expect.anything(), 42, 1500, "Robokassa");
  });
});
