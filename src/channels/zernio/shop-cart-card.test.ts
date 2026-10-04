import { describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Customer } from "@/core/customers/customers";
import { formatMoney } from "@/core/money/money";
import type { ParsedZernioMessage } from "./message";
import type { ZernioTransport } from "./api.server";
import { cartCardText } from "./shop-flow";

/** Б5: покупатель видит, что бот понял корзину, — одной строкой с итогом оформления. */

const added = vi.hoisted(() => ({ rows: [] as Array<Record<string, unknown>> }));
vi.mock("@/core/cart/cart", async (orig) => ({
  ...(await orig<typeof import("@/core/cart/cart")>()),
  // Добавление в корзину — не предмет теста: кладём строку, дальше всё считает настоящий код.
  addToCart: async (ctx: TenantContext, _c: unknown, productId: string) => {
    (ctx.db as unknown as ReturnType<typeof fakeDb>).tables.cart_items!.push(...added.rows);
    return productId ? "ok" : "unavailable";
  },
}));
vi.mock("@/core/catalog/active", () => ({
  allActiveProducts: async () => [{ id: "p-1", name: "Гайд", keywords: null }],
}));

const { cartCard, handleShopMessage } = await import("./shop.server");

const line = (id: string, price: number, quantity: number) => ({
  id: `c-${id}`,
  telegram_id: -1,
  user_key: "ig_1",
  quantity,
  product_variant_id: null,
  created_at: "2026-10-01T00:00:00Z",
  products: {
    id: `p-${id}`,
    name: `Товар ${id}`,
    price,
    currency: "KZT",
    fulfillment_kind: "digital",
    stock_quantity: null,
  },
  product_variants: null,
});

function setup(cart: Array<Record<string, unknown>>) {
  const db = fakeDb({ unique: { zernio_logs: [["event_id"]] } });
  db.rpc = async () => ({ data: true, error: null });
  db.tables.bot_users = [
    {
      user_key: "ig_1",
      platform: "instagram",
      telegram_id: -1,
      loyalty_points: 0,
      state: { locale: "ru", country_code: "KZ" },
    },
  ];
  db.tables.payment_methods = [
    { id: "pm-1", country_code: "KZ", country_name: "Казахстан", is_active: true, sort_order: 1 },
  ];
  db.tables.cart_items = cart;
  db.tables.app_settings = [{ bot_id: "bot-1", key: "shop_currency", value: "KZT" }];
  const ctx = {
    tenant: { id: "bot-1", status: "active", vertical: "digital", modules: {}, settings: {} },
    db,
    appUrl: "https://app.test",
    timezone: "Asia/Almaty",
  } as unknown as TenantContext;
  const customer = {
    userKey: "ig_1",
    platform: "instagram",
    telegramId: -1,
    loyaltyPoints: 0,
    state: db.tables.bot_users![0]!.state,
  } as unknown as Customer;
  return { db, ctx, customer };
}

describe("короткая сводка корзины", () => {
  it("штуки считаются по количеству, сумма — как в оформлении", async () => {
    const { ctx, customer } = setup([line("1", 5000, 2), line("2", 2500, 1)]);
    expect(await cartCard(ctx, customer, "ru")).toBe(
      `🛒 В корзине 3 товара на ${formatMoney(12500, "KZT")}`,
    );
  });

  it("пустая корзина — сводки нет", async () => {
    const { ctx, customer } = setup([]);
    expect(await cartCard(ctx, customer, "ru")).toBeNull();
  });

  it("окно ответа закрыто (событие старше 24 часов) — ничего не шлём", async () => {
    const { ctx, customer } = setup([line("1", 5000, 1)]);
    expect(await cartCard(ctx, customer, "ru", Date.now() - 25 * 3600_000)).toBeNull();
    expect(await cartCard(ctx, customer, "ru", Date.now() - 3600_000)).not.toBeNull();
  });

  it("склонение и четыре языка", () => {
    const t = "1 000 ₸";
    expect(cartCardText("ru", 1, t)).toContain("1 товар на");
    expect(cartCardText("ru", 2, t)).toContain("2 товара на");
    expect(cartCardText("ru", 5, t)).toContain("5 товаров на");
    expect(cartCardText("ru", 11, t)).toContain("11 товаров на");
    expect(cartCardText("ru", 21, t)).toContain("21 товар на");
    expect(cartCardText("kk", 3, t)).toContain("Себетте 3 тауар");
    expect(cartCardText("en", 1, t)).toContain("1 item in");
    expect(cartCardText("en", 3, t)).toContain("3 items in");
    expect(cartCardText("uz", 3, t)).toContain("3 ta mahsulot");
  });
});

describe("корзина из каталога WhatsApp", () => {
  it("перед вопросами оформления бот показывает, что собрал", async () => {
    const { ctx, customer, db } = setup([]);
    added.rows = [line("1", 5000, 1)];
    db.tables.products = [{ id: "p-1", name: "Гайд", is_active: true }];
    const sent: string[] = [];
    const transport = {
      send: vi.fn(async (_c: string, _a: string, text: string) => {
        sent.push(text);
        return { ok: true };
      }),
      tail: vi.fn(async () => []),
      mailReady: () => false,
    } as unknown as ZernioTransport;
    await handleShopMessage(
      ctx,
      customer,
      {
        conversationId: "c",
        accountId: "a",
        platform: "instagram",
        text: "",
        postbackPayload: null,
        nativeOrder: {
          items: [{ retailerId: "p-1", quantity: 1, price: 5000, currency: "KZT" }],
          note: "",
        },
        attachments: [],
      } as unknown as ParsedZernioMessage,
      transport,
    );
    expect(sent[0]).toBe(`🛒 В корзине 1 товар на ${formatMoney(5000, "KZT")}`);
    expect(sent.length).toBeGreaterThan(1);
  });
});
