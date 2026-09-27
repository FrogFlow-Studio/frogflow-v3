import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/core/tenant/resolve.server";

let customer: { telegramId: number } | null = null;
const paused: number[] = [];
vi.mock("@/core/customers/customers", () => ({
  getCustomerByTelegramId: async () => customer,
}));
vi.mock("@/core/consultant/engine.server", () => ({
  pauseConsultant: async (_ctx: unknown, c: { telegramId: number }) => {
    paused.push(c.telegramId);
  },
}));

const { pauseBotAfterManagerReply } = await import("./admin.server");
const ctx = { tenant: { id: "bot", settings: {} } } as unknown as TenantContext;

beforeEach(() => {
  paused.length = 0;
  customer = { telegramId: 7 };
});

describe("ответ продавца из «Чата» ставит бота на паузу", () => {
  it("консультант этого покупателя замолкает", async () => {
    await pauseBotAfterManagerReply(ctx, 7);
    expect(paused).toEqual([7]);
  });

  it("покупателя нет в базе — ничего не делаем", async () => {
    customer = null;
    await pauseBotAfterManagerReply(ctx, 7);
    expect(paused).toEqual([]);
  });
});
