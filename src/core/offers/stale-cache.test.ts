import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Customer } from "@/core/customers/customers";
import { placeOrder } from "@/core/orders/orders";
import { resolvePrice } from "@/core/pricing/pricing";
import { OFFERS_KEY, resetOffersCache } from "./offers";

/**
 * Н2: акция кешируется на минуту, но цена заказа — деньги. «Закончить сейчас»
 * и лимит штук должны действовать на оформление сразу, а не через минуту.
 */
const BOT = "11111111-1111-1111-1111-111111111111";
const TG = 777;
const product = {
  id: "p-1",
  name: "Торт",
  price: 1000,
  currency: "KZT",
  fulfillment_kind: "digital",
  file_path: `${BOT}/m.pdf`,
};
const offer = {
  id: "o1",
  product_id: "p-1",
  percent: 30,
  starts_at: "2026-10-01T00:00:00Z",
  ends_at: "2026-10-12T18:59:00Z",
  limit: 3,
};

function setup() {
  const db = fakeDb();
  db.rpc = async () => ({ data: true, error: null });
  db.tables.app_settings = [{ bot_id: BOT, key: OFFERS_KEY, value: JSON.stringify([offer]) }];
  db.tables.bot_users = [{ telegram_id: TG, user_key: `tg:${TG}`, loyalty_points: 0, state: {} }];
  db.tables.payment_methods = [
    { id: "pm-1", country_code: "KZ", country_name: "Казахстан", is_active: true, sort_order: 1 },
  ];
  db.tables.products = [{ id: "p-1", stock_quantity: 100 }];
  db.tables.order_items = [];
  db.tables.cart_items = [
    {
      id: "c-1",
      telegram_id: TG,
      quantity: 1,
      product_variant_id: null,
      created_at: "2026-09-26T00:00:00Z",
      products: product,
      product_variants: null,
    },
  ];
  const ctx = {
    tenant: { id: BOT, modules: { limited_offers: true }, settings: {} },
    db,
  } as unknown as TenantContext;
  const customer: Customer = {
    userKey: `tg:${TG}`,
    platform: "telegram",
    telegramId: TG,
    username: null,
    firstName: "Аня",
    lastName: null,
    languageCode: "ru",
    contactPhone: null,
    email: null,
    loyaltyPoints: 0,
    state: {},
    zernioConversationId: null,
    zernioAccountId: null,
  };
  return { db, ctx, customer };
}

beforeEach(() => {
  resetOffersCache();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-05T10:00:00Z"));
});
afterEach(() => vi.useRealTimers());

describe("акция и оформление заказа", () => {
  it("«Закончить сейчас» на другом экземпляре: заказ уже по полной цене", async () => {
    const { db, ctx, customer } = setup();
    // Витрина этого экземпляра показала скидку и прогрела кеш.
    expect((await resolvePrice(ctx, product, null)).amount).toBe(700);
    // Продавец закончил акцию — запись изменилась, наш кеш об этом не знает.
    db.tables.app_settings![0]!.value = JSON.stringify([
      { ...offer, ends_at: "2026-10-05T09:59:00Z" },
    ]);
    const r = await placeOrder(ctx, customer, "KZ", {});
    if (!r.ok) throw new Error(`не оформился: ${r.reason}`);
    expect(Number(r.order.total)).toBe(1000);
  });
});
