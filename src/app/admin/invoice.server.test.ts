import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";

/** «Выставить счёт» из «Чата»: сообщение с кнопкой оформления в канал покупателя. */
let customer: Record<string, unknown> | null;
let fill: unknown;
const calls: Array<{ method: string; body: Record<string, unknown> }> = [];
const zernio: Array<{ text: string; opts: Record<string, unknown> }> = [];
const log: string[] = [];
const disconnected: number[] = [];
let direct = { enabled: true, features: { checkout: true } };
let webPay = true;
let placed: Record<string, unknown>;
const placeCalls: unknown[][] = [];
const confirmed: number[] = [];

vi.mock("@/config/env", () => ({
  env: () => ({ TELEGRAM_API_BASE: "https://tg", SESSION_SECRET: "secret" }),
}));
vi.mock("@/core/storefront/access", () => ({ storefrontOpen: () => webPay }));
vi.mock("@/core/storefront/web-order", () => ({
  webCheckoutSettings: async () => ({ enabled: webPay }),
  orderAccessToken: (_s: string, bot: string, id: number) => `tok-${bot}-${id}`,
}));
// rejectOrder — настоящий: остаток при отмене счёта возвращает только он.
vi.mock("@/core/orders/orders", async (orig) => ({
  ...(await orig<typeof import("@/core/orders/orders")>()),
  displayNo: (o: { display_no: number }) => o.display_no,
  listActivePaymentMethods: async () => [{ country_code: "KZ" }],
  placeOrder: async (...a: unknown[]) => {
    placeCalls.push(a);
    return placed;
  },
}));
vi.mock("./admin.server", () => ({
  runOrderAction: async (_c: unknown, id: number) => {
    confirmed.push(id);
    return { ok: true, message: "" };
  },
}));
vi.mock("@/core/customers/customers", () => ({
  getCustomerByTelegramId: async () => customer,
  isBlocked: async () => false,
}));
let fillCalls = 0;
vi.mock("@/core/cart/seller-cart", () => ({
  fillCartForCustomer: async () => {
    fillCalls++;
    return fill;
  },
}));
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

let db: FakeDb;
const ctx = (modules: Record<string, boolean> = {}, settings: Record<string, unknown> = {}) =>
  ({
    db,
    tenant: { id: "b", modules, settings, telegramTokenEnc: "enc" },
    appUrl: "https://shop.test",
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
  db = fakeDb({ unique: { app_settings: [["bot_id", "key"]] } });
  db.tables.app_settings = [];
  db.tables.products = [{ id: "p", bot_id: "b", name: "Прописи", fulfillment_kind: "digital" }];
  fillCalls = 0;
  customer = { telegramId: 5, platform: "telegram", state: {} };
  fill = { ok: true, cart };
  calls.length = 0;
  zernio.length = 0;
  log.length = 0;
  disconnected.length = 0;
  direct = { enabled: true, features: { checkout: true } };
  webPay = true;
  placed = { ok: true, order: { id: 77, display_no: 12 }, zeroTotal: false };
  placeCalls.length = 0;
  confirmed.length = 0;
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

  it("в канале нет оформления и нет оплаты на сайте — отказ до того, как тронута корзина", async () => {
    webPay = false;
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

  const igNoShop = () => {
    customer = {
      telegramId: -7,
      platform: "instagram",
      state: {},
      zernioConversationId: "conv",
      zernioAccountId: "acc",
    };
    direct = { enabled: true, features: { checkout: false } };
  };

  it("Instagram без оформления в канале: заказ сразу и ссылка на его страницу на сайте", async () => {
    igNoShop();
    const r = await sendDialogInvoice(ctx({ dm_shop: true }, { slug: "propisi" }), -7, items);
    expect(r).toEqual({ total: 4500, currency: "KZT", orderId: 77, orderNo: 12 });
    expect(placeCalls).toHaveLength(1);
    expect(placeCalls[0]![2]).toBe("KZ");
    expect(zernio[0]!.text).toContain("Заказ №12");
    expect(zernio[0]!.text).toContain("https://shop.test/s/propisi/order/77?t=tok-b-77");
    expect(zernio[0]!.text).not.toContain("Нажмите «Оформить заказ»");
    // Кнопки оформления нет: оформлять нечего, заказ уже создан.
    expect(zernio[0]!.opts.buttons).toBeUndefined();
    // Менеджер остаётся в диалоге: бот тут ничего не оформляет.
    expect(disconnected).toHaveLength(0);
    expect(confirmed).toHaveLength(0);
    // Признак «счёт ссылкой»: по нему страница заказа, срок оплаты и возврат остатка.
    expect(db.tables.app_settings).toEqual([
      expect.objectContaining({ bot_id: "b", key: "invoice_link:77" }),
    ]);
  });

  it("ссылкой — только цифровые товары, отказ до того, как корзина покупателя заменена", async () => {
    igNoShop();
    db.tables.products![0]!.fulfillment_kind = "physical";
    await expect(
      sendDialogInvoice(ctx({ dm_shop: true }, { slug: "propisi" }), -7, items),
    ).rejects.toMatchObject({ key: "err.invoice.linkPhysical" });
    expect(fillCalls).toBe(0);
    expect(placeCalls).toHaveLength(0);
    expect(zernio).toHaveLength(0);
  });

  it("длинный состав обрезается, а ссылка на оплату в конце остаётся целой", async () => {
    igNoShop();
    const many = Array.from({ length: 120 }, (_, i) => ({
      item: { quantity: 1 },
      name: `Очень длинное название набора для занятий номер ${i}`,
      line: 100,
    }));
    fill = { ok: true, cart: { ...cart, lines: many } };
    await sendDialogInvoice(ctx({ dm_shop: true }, { slug: "propisi" }), -7, items);
    expect(zernio[0]!.text.length).toBeLessThanOrEqual(2000);
    expect(zernio[0]!.text).toContain("https://shop.test/s/propisi/order/77?t=tok-b-77");
  });

  it("заказ не создался (закончился товар) — понятная ошибка, ничего не отправлено", async () => {
    igNoShop();
    placed = { ok: false, reason: "out_of_stock" };
    await expect(
      sendDialogInvoice(ctx({ dm_shop: true }, { slug: "propisi" }), -7, items),
    ).rejects.toMatchObject({ key: "err.invoice.outOfStock" });
    expect(zernio).toHaveLength(0);
  });

  it("признак «счёт ссылкой» не записался — счёт отменён, остаток возвращён один раз, сообщения нет", async () => {
    igNoShop();
    db.tables.products![0]!.stock_quantity = 3;
    db.tables.orders = [
      {
        id: 77,
        bot_id: "b",
        platform: "instagram",
        telegram_id: -7,
        status: "awaiting_payment",
        paid_amount: 0,
        points_used: 0,
        points_earned: 0,
        delivery_index: 0,
      },
    ];
    db.tables.order_items = [{ id: "i", order_id: 77, product_id: "p", quantity: 1 }];
    db.tables.zernio_logs = [];
    // Признак уже записан (ответ базы потерялся) — повторная вставка падает.
    db.tables.app_settings = [{ bot_id: "b", key: "invoice_link:77", value: "1" }];
    await expect(
      sendDialogInvoice(ctx({ dm_shop: true, stock: true }, { slug: "propisi" }), -7, items),
    ).rejects.toMatchObject({ key: "err.invoice.cancelled" });
    expect(db.tables.orders[0]!.status).toBe("cancelled");
    expect(db.tables.products![0]!.stock_quantity).toBe(4);
    expect(zernio).toHaveLength(0);
    expect(confirmed).toHaveLength(0);
  });

  it("скидки покрыли всё — заказ выдаётся сразу, уже как счёт ссылкой", async () => {
    igNoShop();
    placed = { ok: true, order: { id: 78, display_no: 13 }, zeroTotal: true };
    await sendDialogInvoice(ctx({ dm_shop: true }, { slug: "propisi" }), -7, items);
    expect(confirmed).toEqual([78]);
    expect(db.tables.app_settings!.map((r) => r.key)).toEqual(["invoice_link:78"]);
  });

  it("режимы: Telegram кнопкой, Instagram без оформления — ссылкой, без витрины — никак", async () => {
    igNoShop();
    const { invoiceMode } = await import("./invoice.server");
    expect(await invoiceMode(ctx({}, { slug: "s" }), "telegram")).toBe("channel");
    expect(await invoiceMode(ctx({ dm_shop: true }, { slug: "s" }), "instagram")).toBe("link");
    expect(await invoiceMode(ctx({ dm_shop: true }), "instagram")).toBe("none");
    webPay = false;
    expect(await invoiceMode(ctx({ dm_shop: true }, { slug: "s" }), "instagram")).toBe("none");
    direct = { enabled: true, features: { checkout: true } };
    expect(await invoiceMode(ctx({ dm_shop: true }), "instagram")).toBe("channel");
  });
});
