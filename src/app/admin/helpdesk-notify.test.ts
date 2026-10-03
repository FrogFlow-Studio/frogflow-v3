import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/core/tenant/resolve.server";

const sent: Array<{ id: number; text: string; markup?: unknown }> = [];
const asked: string[] = [];
let fail = false;
let customer: { platform?: string; state: { locale?: string } } | null = null;
vi.mock("./admin.server", () => ({
  replyAsManager: async (
    _ctx: unknown,
    id: number,
    text: string,
    _att: unknown,
    _draft: unknown,
    options?: { replyMarkup?: unknown },
  ) => {
    if (fail) throw new Error("Zernio 500");
    sent.push({ id, text, markup: options?.replyMarkup });
  },
}));
let ratedAlready = false;
vi.mock("@/core/helpdesk/tickets", () => ({
  getTicket: async () => ({ rating: ratedAlready ? 4 : null }),
  markRatingAsked: async (_ctx: unknown, id: string) => void asked.push(id),
}));
vi.mock("@/core/customers/customers", () => ({
  getCustomerByTelegramId: async () => customer,
}));

const { notifyTicketClosed } = await import("./helpdesk.server");
const ctx = (default_locale?: string) =>
  ({ tenant: { id: "bot", settings: { default_locale } } }) as unknown as TenantContext;

beforeEach(() => {
  sent.length = 0;
  asked.length = 0;
  ratedAlready = false;
  fail = false;
  customer = { platform: "telegram", state: {} };
});

describe("покупателю — «обращение закрыто»", () => {
  it("уходит на языке покупателя, иначе на языке магазина", async () => {
    customer = { platform: "telegram", state: { locale: "kk" } };
    expect(await notifyTicketClosed(ctx("ru"), { id: "t12", number: 12, telegramId: 5 })).toBe(
      true,
    );
    expect(sent[0]!.text).toBe(
      "✅ #12 өтініш жабылды. Сұрақ қалса — қайта жазыңыз.\n\nКөмегімізді бағалаңыз:",
    );
    customer = { platform: "telegram", state: {} };
    await notifyTicketClosed(ctx(), { id: "t13", number: 13, telegramId: 5 });
    expect(sent[1]!.text).toContain("Обращение #13 закрыто");
  });

  it("не доставилось — false, без исключения: статус уже сменён", async () => {
    fail = true;
    expect(await notifyTicketClosed(ctx(), { id: "t1", number: 1, telegramId: 5 })).toBe(false);
  });

  it("Telegram: просьба оценить — пять кнопок с id обращения, момент просьбы запоминается", async () => {
    customer = { platform: "telegram", state: {} };
    await notifyTicketClosed(ctx(), { id: "t7", number: 7, telegramId: 5 });
    const rows = (sent[0]!.markup as { inline_keyboard: { callback_data: string }[][] })
      .inline_keyboard;
    expect(rows[0]!.map((b) => b.callback_data)).toEqual([1, 2, 3, 4, 5].map((n) => `tkr:t7:${n}`));
    expect(asked).toEqual(["t7"]);
  });

  it("Instagram/WhatsApp: кнопок нет, просят ответить цифрой", async () => {
    customer = { platform: "whatsapp", state: { locale: "en" } };
    await notifyTicketClosed(ctx(), { id: "t8", number: 8, telegramId: 5 });
    expect(sent[0]!.markup).toBeUndefined();
    expect(sent[0]!.text).toContain("reply with a number from 1 to 5");
    expect(asked).toEqual(["t8"]);
  });

  it("уже оценённое обращение, закрытое повторно, оценить не просят", async () => {
    ratedAlready = true;
    await notifyTicketClosed(ctx(), { id: "t9", number: 9, telegramId: 5 });
    expect(sent[0]!.text).toBe("✅ Обращение #9 закрыто. Если вопрос остался — напишите снова.");
    expect(sent[0]!.markup).toBeUndefined();
    expect(asked).toEqual([]);
  });
});
