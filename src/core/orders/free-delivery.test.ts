import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import { withBrokenReads } from "../../../tests/broken-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Customer } from "@/core/customers/customers";
import { placeOrder } from "./orders";

/**
 * Бесплатная доставка от суммы (Д3): placeOrder сравнивает товары ПОСЛЕ
 * скидок и баллов с порогом зоны или общим, на самой границе тоже.
 */
const BOT = "11111111-1111-1111-1111-111111111111";
const TG = 777;
const ZONE = "22222222-2222-4222-8222-222222222222";
const ZONE_2 = "33333333-3333-4333-8333-333333333333";
const FEE = 500;

function setup(o: {
  prices: number[];
  general?: number;
  zones?: Record<string, number>;
  points?: number;
}) {
  const db = fakeDb();
  db.rpc = async () => ({ data: true, error: null });
  db.tables.bot_users = [
    { telegram_id: TG, user_key: `tg:${TG}`, loyalty_points: o.points ?? 0, state: {} },
  ];
  db.tables.payment_methods = [
    { id: "pm-1", country_code: "KZ", country_name: "Казахстан", is_active: true, sort_order: 1 },
  ];
  db.tables.cart_items = o.prices.map((price, i) => ({
    id: `c-${i}`,
    telegram_id: TG,
    quantity: 1,
    product_variant_id: null,
    created_at: `2026-09-26T00:00:0${i}Z`,
    products: {
      id: `p-${i}`,
      name: `Торт ${i}`,
      price,
      currency: "KZT",
      fulfillment_kind: "physical",
      stock_quantity: null,
    },
    product_variants: null,
  }));
  db.tables.promo_codes = [
    {
      id: "promo-1",
      bot_id: BOT,
      code: "TEN",
      discount_type: "percent",
      discount_value: 10,
      used_count: 0,
      max_uses: null,
      valid_until: null,
      is_active: true,
    },
  ];
  db.tables.app_settings = [
    ...(o.general ? [{ bot_id: BOT, key: "delivery_free_from", value: String(o.general) }] : []),
    ...(o.zones
      ? [{ bot_id: BOT, key: "delivery_free_zones", value: JSON.stringify(o.zones) }]
      : []),
  ];
  const ctx = {
    tenant: { id: BOT, modules: { loyalty: true, coupons: true }, settings: {} },
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
    loyaltyPoints: o.points ?? 0,
    state: {},
    zernioConversationId: null,
    zernioAccountId: null,
  };
  return { db, ctx, customer };
}

const delivery = (zone = ZONE) => ({
  type: "delivery" as const,
  at: null,
  address: "ул. Тестовая, 1",
  note: null,
  zone: { id: zone, name: "Центр", fee: FEE },
});

const order = (db: ReturnType<typeof setup>["db"]) => db.tables.orders![0]!;

describe("бесплатная доставка: граница порога", () => {
  it("ровно порог — доставка 0, ниже на тенге — платная", async () => {
    const at = setup({ prices: [2000, 1000], general: 3000 });
    expect((await placeOrder(at.ctx, at.customer, "KZ", { fulfillment: delivery() })).ok).toBe(
      true,
    );
    expect(order(at.db)).toMatchObject({
      delivery_fee: 0,
      total: 3000,
      delivery_zone_name: "Центр",
    });

    const below = setup({ prices: [2000, 999], general: 3000 });
    await placeOrder(below.ctx, below.customer, "KZ", { fulfillment: delivery() });
    expect(order(below.db)).toMatchObject({ delivery_fee: FEE, total: 2999 + FEE });
  });

  it("порога нет — доставка по тарифу зоны, как раньше", async () => {
    const s = setup({ prices: [9000] });
    await placeOrder(s.ctx, s.customer, "KZ", { fulfillment: delivery() });
    expect(order(s.db)).toMatchObject({ delivery_fee: FEE, total: 9000 + FEE });
  });

  it("самовывоз и зона без платы порог не трогают", async () => {
    const s = setup({ prices: [5000], general: 3000 });
    await placeOrder(s.ctx, s.customer, "KZ", {
      fulfillment: { type: "pickup", at: null, address: null, note: null, zone: null },
    });
    expect(order(s.db)).toMatchObject({ delivery_fee: 0, total: 5000 });
  });
});

describe("бесплатная доставка: порог считается после скидок и баллов", () => {
  it("промокод опускает товары под порог — доставка платная; без кода — бесплатная", async () => {
    // 3300 без кода ≥ 3000; с кодом −10 % = 2970 < 3000.
    const withCode = setup({ prices: [2300, 1000], general: 3000 });
    await placeOrder(withCode.ctx, withCode.customer, "KZ", {
      fulfillment: delivery(),
      promoCode: "ten",
    });
    expect(order(withCode.db)).toMatchObject({ delivery_fee: FEE });
    expect(order(withCode.db).promo_code).toBe("TEN");

    const without = setup({ prices: [2300, 1000], general: 3000 });
    await placeOrder(without.ctx, without.customer, "KZ", { fulfillment: delivery() });
    expect(order(without.db)).toMatchObject({ delivery_fee: 0, total: 3300 });
  });

  it("промокод, после которого товары всё ещё ≥ порога — доставка бесплатная, скидка на товары", async () => {
    // 4000 − 10 % = 3600 ≥ 3000.
    const s = setup({ prices: [3000, 1000], general: 3000 });
    await placeOrder(s.ctx, s.customer, "KZ", { fulfillment: delivery(), promoCode: "ten" });
    expect(order(s.db)).toMatchObject({ delivery_fee: 0, total: 3600 });
  });

  it("баллы: ровно до порога — бесплатно, на балл меньше — платно", async () => {
    // 3300 − 300 баллов = 3000.
    const exact = setup({ prices: [2300, 1000], general: 3000, points: 300 });
    await placeOrder(exact.ctx, exact.customer, "KZ", {
      fulfillment: delivery(),
      usePoints: true,
    });
    expect(order(exact.db)).toMatchObject({ delivery_fee: 0, points_used: 300 });

    // 3300 − 301 = 2999 < 3000.
    const short = setup({ prices: [2300, 1000], general: 3000, points: 301 });
    await placeOrder(short.ctx, short.customer, "KZ", {
      fulfillment: delivery(),
      usePoints: true,
    });
    expect(order(short.db)).toMatchObject({ delivery_fee: FEE, points_used: 301 });
  });
});

describe("бесплатная доставка: порог зоны важнее общего", () => {
  it("у зоны свой порог ниже общего — бесплатно; у другой зоны — общий", async () => {
    const own = setup({ prices: [2000], general: 5000, zones: { [ZONE]: 2000 } });
    await placeOrder(own.ctx, own.customer, "KZ", { fulfillment: delivery() });
    expect(order(own.db)).toMatchObject({ delivery_fee: 0 });

    const other = setup({ prices: [2000], general: 5000, zones: { [ZONE]: 2000 } });
    await placeOrder(other.ctx, other.customer, "KZ", { fulfillment: delivery(ZONE_2) });
    expect(order(other.db)).toMatchObject({ delivery_fee: FEE });
  });

  it("порог только у зоны, общего нет: другая зона платная", async () => {
    const s = setup({ prices: [4000], zones: { [ZONE]: 3000 } });
    await placeOrder(s.ctx, s.customer, "KZ", { fulfillment: delivery(ZONE_2) });
    expect(order(s.db)).toMatchObject({ delivery_fee: FEE });
  });
});

describe("бесплатная доставка: сбой чтения порога", () => {
  it("не прочитали настройки — заказ не создаётся и не уходит с платной доставкой молча", async () => {
    const s = setup({ prices: [4000], general: 3000 });
    s.ctx.db = withBrokenReads(s.db, ["app_settings"]) as unknown as TenantContext["db"];
    await expect(placeOrder(s.ctx, s.customer, "KZ", { fulfillment: delivery() })).rejects.toThrow(
      /delivery_free_from|delivery_free_zones|Настройк/,
    );
    expect(s.db.tables.orders ?? []).toHaveLength(0);
  });
});
