import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/core/tenant/resolve.server";

/** «Выставить счёт» из «Чата»: сообщение с кнопкой оформления в канал покупателя. */
let customer: Record<string, unknown> | null;
let fill: unknown;
const calls: Array<{ method: string; body: Record<string, unknown> }> = [];
const zernio: Array<{ text: string; opts: Record<string, unknown> }> = [];
const log: string[] = [];
const disconnected: number[] = [];
let direct = { enabled: true, features: { checkout: true } };

vi.mock("@/config/env", () => ({ env: () => ({ TELEGRAM_API_BASE: "https://tg" }) }));
vi.mock("@/core/customers/customers", () => ({
  getCustomerByTelegramId: async () => customer,
  isBlocked: async () => false,
}));
vi.mock("@/core/cart/seller-cart", () => ({ fillCartForCustomer: async () => fill }));
vi.mock("@/channels/telegram/api", () => ({
  telegramApi: () => ({
    call: async (method: string, body: Record<string, unknown>) => {
      calls.push({ method, body });
      return { ok: true };
    },
  }),
}));
vi.mock("@/channels/zernio/api.server", () => ({
  sendInboxMessage: async (_c: string, _a: string, text: string, opts: Record<string, unknown>) => {
    zernio.push({ text, opts });
    return { ok: true };
  },
}));
vi.mock("@/core/instagram/direct-bot-settings", () => ({
  loadDirectBotSettings: async () => direct,
}));
vi.mock("@/core/chat/chat", () => ({
  recordMessage: async (_ctx: unknown, m: { text: string }) => void log.push(m.text),
  disconnect: async (_ctx: unknown, id: number) => void disconnected.push(id),
}));

const { sendDialogInvoice } = await import("./invoice.server");

const ctx = (modules: Record<string, boolean> = {}) =>
  ({
    tenant: { id: "b", modules, settings: {}, telegramTokenEnc: "enc" },
    secrets: { telegramToken: () => "token" },
  }) as unknown as TenantContext;
const cart = {
  lines: [
    { item: { quantity: 2 }, name: "Набор <А>", line: 3000 },
    { item: { quantity: 1 }, name: "Карточки", line: 1500 },
  ],
  total: 4500,
  currency: "KZT",
  kind: "digital",
};
const items = [{ productId: "p", variantId: null, quantity: 1 }];

beforeEach(() => {
  customer = { telegramId: 5, platform: "telegram", state: {} };
  fill = { ok: true, cart };
  calls.length = 0;
  zernio.length = 0;
  log.length = 0;
  disconnected.length = 0;
  direct = { enabled: true, features: { checkout: true } };
});

describe("счёт из диалога", () => {
  it("Telegram: позиции и итог, кнопка «Оформить заказ» ведёт в обычное оформление", async () => {
    expect(await sendDialogInvoice(ctx(), 5, items)).toEqual({ total: 4500, currency: "KZT" });
    const { method, body } = calls[0]!;
    expect(method).toBe("sendMessage");
    expect(body.text).toContain("Счёт от продавца");
    expect(body.text).toContain("1. Набор &lt;А&gt; × 2");
    expect(body.text).toContain("Итого");
    expect(body.reply_markup).toEqual({
      inline_keyboard: [[{ text: "✅ Оформить заказ", callback_data: "checkout" }]],
    });
    expect(log[0]).toContain("Счёт от продавца");
    // Оформление ведёт бот: пока менеджер «в чате», нажатие кнопки бот не увидит.
    expect(disconnected).toEqual([5]);
  });

  it("на языке покупателя", async () => {
    customer = { telegramId: 5, platform: "telegram", state: { locale: "kk" } };
    await sendDialogInvoice(ctx(), 5, items);
    expect(calls[0]!.body.text).toContain("Сатушының шоты");
  });

  it("Instagram: текстом и кнопкой CHECKOUT, как корзина магазина в Direct", async () => {
    customer = {
      telegramId: -7,
      platform: "instagram",
      state: {},
      zernioConversationId: "conv",
      zernioAccountId: "acc",
    };
    await sendDialogInvoice(ctx({ dm_shop: true }), -7, items);
    expect(zernio[0]!.text).not.toContain("<b>");
    expect(zernio[0]!.opts.buttons).toEqual([
      { type: "postback", title: "✅ Оформить заказ", payload: "CHECKOUT" },
    ]);
  });

  it("в канале нет оформления — отказ до того, как тронута корзина", async () => {
    customer = { telegramId: -7, platform: "whatsapp", state: {} };
    await expect(sendDialogInvoice(ctx({ wa_shop: false }), -7, items)).rejects.toMatchObject({
      key: "err.invoice.noShopInChannel",
    });
    direct = { enabled: true, features: { checkout: false } };
    await expect(sendDialogInvoice(ctx({ wa_shop: true }), -7, items)).rejects.toMatchObject({
      key: "err.invoice.noShopInChannel",
    });
    expect(zernio).toHaveLength(0);
  });

  it("позиция не прошла проверку — понятная ошибка, ничего не отправлено", async () => {
    fill = { ok: false, reason: "mixed_cart" };
    await expect(sendDialogInvoice(ctx(), 5, items)).rejects.toMatchObject({
      key: "err.invoice.mixed",
    });
    expect(calls).toHaveLength(0);
    expect(disconnected).toHaveLength(0);
  });
});
