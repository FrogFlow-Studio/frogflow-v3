import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/core/tenant/resolve.server";

const sent: Array<{ id: number; text: string }> = [];
let fail = false;
let customer: { state: { locale?: string } } | null = null;
vi.mock("./admin.server", () => ({
  replyAsManager: async (_ctx: unknown, id: number, text: string) => {
    if (fail) throw new Error("Zernio 500");
    sent.push({ id, text });
  },
}));
vi.mock("@/core/customers/customers", () => ({
  getCustomerByTelegramId: async () => customer,
}));

const { notifyTicketClosed } = await import("./helpdesk.server");
const ctx = (default_locale?: string) =>
  ({ tenant: { id: "bot", settings: { default_locale } } }) as unknown as TenantContext;

beforeEach(() => {
  sent.length = 0;
  fail = false;
  customer = { state: {} };
});

describe("покупателю — «обращение закрыто»", () => {
  it("уходит на языке покупателя, иначе на языке магазина", async () => {
    customer = { state: { locale: "kk" } };
    expect(await notifyTicketClosed(ctx("ru"), { number: 12, telegramId: 5 })).toBe(true);
    expect(sent[0]).toEqual({ id: 5, text: "✅ #12 өтініш жабылды. Сұрақ қалса — қайта жазыңыз." });
    customer = { state: {} };
    await notifyTicketClosed(ctx(), { number: 13, telegramId: 5 });
    expect(sent[1]!.text).toContain("Обращение #13 закрыто");
  });

  it("не доставилось — false, без исключения: статус уже сменён", async () => {
    fail = true;
    expect(await notifyTicketClosed(ctx(), { number: 1, telegramId: 5 })).toBe(false);
  });
});
