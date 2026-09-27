import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Customer } from "@/core/customers/customers";
import { cartSummary, placeOrder } from "@/core/orders/orders";
import { setFxProvider, resetPricingCache, defaultFxProvider } from "@/core/pricing/pricing";
import { awardPointsForOrder } from "./discounts";

/**
 * Скидки — в валюте заказа: баллы и фиксированный промокод из валюты
 * магазина (KZT), сертификат — из своей currency. Курсы — те же, что у цен.
 * 1 USD = 500 KZT = 100 RUB, значит 1 RUB = 5 KZT.
 */
const RATES = { USD: 1, KZT: 500, RUB: 100 };
const BOT = "11111111-1111-1111-1111-111111111111";
const TG = 777;

function setup(orderCurrency: string, price: number) {
  const db = fakeDb();
  db.rpc = async () => ({ data: true, error: null });
  db.tables.app_settings = [{ bot_id: BOT, key: "shop_currency", value: "KZT" }];
  db.tables.bot_users = [
    { telegram_id: TG, user_key: `tg:${TG}`, loyalty_points: 1000, state: {} },
  ];
  db.tables.payment_methods = [
    { id: "pm-1", country_code: "RU", country_name: "Россия", is_active: true, sort_order: 1 },
  ];
  db.tables.cart_items = [
    {
      id: "c-1",
      telegram_id: TG,
      quantity: 1,
      product_variant_id: null,
      created_at: "2026-09-26T00:00:00Z",
      products: {
        id: "p-1",
        name: "Методичка",
        price,
        currency: orderCurrency,
        fulfillment_kind: "digital",
        file_path: `${BOT}/m.pdf`,
      },
      product_variants: null,
    },
  ];
  db.tables.promo_codes = [
    {
      id: "promo-1",
      code: "MINUS500",
      discount_type: "fixed",
      discount_value: 500,
      used_count: 0,
      max_uses: null,
      valid_until: null,
      is_active: true,
    },
  ];
  db.tables.gift_certificates = [
    {
      id: "gift-1",
      code: "GIFT-KZT1000",
      amount: 1000,
      currency: "KZT",
      status: "active",
      redeemed_by_telegram_id: null,
      redeemed_order_id: null,
      redeemed_at: null,
    },
  ];
  const ctx = {
    tenant: {
      id: BOT,
      modules: { loyalty: true, coupons: true, gift_certificates: true },
      settings: {},
    },
    db,
  } as unknown as TenantContext;
  const customer = {
    userKey: `tg:${TG}`,
    platform: "telegram",
    telegramId: TG,
    username: null,
    firstName: "Аня",
    lastName: null,
    languageCode: "ru",
    contactPhone: null,
    email: null,
    loyaltyPoints: 1000,
    state: {},
    zernioConversationId: null,
    zernioAccountId: null,
  } as Customer;
  return { db, ctx, customer };
}

const points = (db: ReturnType<typeof fakeDb>) => db.tables.bot_users![0]!.loyalty_points;

beforeEach(() => setFxProvider(async () => RATES));
afterEach(() => {
  setFxProvider(defaultFxProvider);
  resetPricingCache();
});

describe("скидки в валюте заказа", () => {
  it("заказ в рублях: 1000 баллов (KZT) = 200 ₽ скидки, с баланса уходит 1000", async () => {
    const { db, ctx, customer } = setup("RUB", 1000);
    const r = await placeOrder(ctx, customer, "RU", { usePoints: true });
    if (!r.ok) throw new Error(r.reason);
    expect(Number(r.order.total)).toBe(800);
    expect(r.order.points_used).toBe(1000);
    expect(points(db)).toBe(0);
  });

  it("заказ в рублях дешевле баланса: скидка — вся сумма, баллов уходит по курсу", async () => {
    const { db, ctx, customer } = setup("RUB", 100);
    const r = await placeOrder(ctx, customer, "RU", { usePoints: true });
    if (!r.ok) throw new Error(r.reason);
    expect(Number(r.order.total)).toBe(0);
    expect(r.order.points_used).toBe(500);
    expect(points(db)).toBe(500);
  });

  it("корзина в рублях показывает пересчёт: 500 баллов = 100 ₽; в тенге — без пересчёта", async () => {
    const { ctx, customer } = setup("RUB", 100);
    const rub = await cartSummary(
      ctx,
      customer,
      { total: 100, currency: "RUB" },
      { usePoints: true },
    );
    expect(rub.points).toMatchObject({ discount: 100, spent: 500, fx: true });
    const kzt = await cartSummary(
      ctx,
      customer,
      { total: 300, currency: "KZT" },
      { usePoints: true },
    );
    expect(kzt.points).toMatchObject({ discount: 300, spent: 300, fx: false });
  });

  it("сертификат на 1000 ₸ и промокод 500 ₸ на заказ в рублях — 200 ₽ и 100 ₽", async () => {
    const { ctx, customer } = setup("RUB", 1000);
    const r = await placeOrder(ctx, customer, "RU", {
      promoCode: "minus500",
      giftCode: "gift-kzt1000",
    });
    if (!r.ok) throw new Error(r.reason);
    expect(Number(r.order.discount_amount)).toBe(100);
    expect(Number(r.order.gift_certificate_discount)).toBe(200);
    expect(Number(r.order.total)).toBe(700);
  });

  it("остаток сертификата на заказе в рублях — в тенге сертификата (#257)", async () => {
    const { db, ctx, customer } = setup("RUB", 100);
    const r = await placeOrder(ctx, customer, "RU", { giftCode: "GIFT-KZT1000" });
    if (!r.ok) throw new Error(r.reason);
    // 1000 ₸ = 200 ₽, заказ 100 ₽: списана половина, остаток 500 ₸.
    expect(Number(r.order.gift_certificate_discount)).toBe(100);
    expect(r.giftRest).toMatchObject({ amount: 500, currency: "KZT" });
    const rest = db.tables.gift_certificates!.find((c) => c.code === r.giftRest!.code);
    expect(rest).toMatchObject({ amount: 500, currency: "KZT", status: "active" });
  });

  it("заказ в тенге — как раньше, 1 к 1", async () => {
    const { db, ctx, customer } = setup("KZT", 5000);
    const r = await placeOrder(ctx, customer, "RU", {
      usePoints: true,
      promoCode: "MINUS500",
      giftCode: "GIFT-KZT1000",
    });
    if (!r.ok) throw new Error(r.reason);
    expect(Number(r.order.total)).toBe(5000 - 500 - 1000 - 1000);
    expect(points(db)).toBe(0);
  });

  it("курса нет — понятный отказ, ничего не списано; в корзине скидки нет, флаг discountFx", async () => {
    setFxProvider(async () => {
      throw new Error("нет сети");
    });
    const { db, ctx, customer } = setup("RUB", 1000);
    const sum = await cartSummary(
      ctx,
      customer,
      { total: 1000, currency: "RUB" },
      { usePoints: true, giftCode: "GIFT-KZT1000" },
    );
    expect(sum).toMatchObject({ discountFx: true, total: 1000, gift: null });
    const r = await placeOrder(ctx, customer, "RU", { usePoints: true });
    expect(r).toMatchObject({ ok: false, reason: "discount_fx" });
    expect(points(db)).toBe(1000);
    const g = await placeOrder(ctx, customer, "RU", { giftCode: "GIFT-KZT1000" });
    expect(g).toMatchObject({ ok: false, reason: "discount_fx" });
    expect(db.tables.gift_certificates![0]!.status).toBe("active");
  });

  it("начисление за заказ в рублях — в баллах валюты магазина", async () => {
    const { db, ctx } = setup("RUB", 1000);
    db.tables.orders = [{ id: 5, points_earned: 0 }];
    db.tables.app_settings!.push({ bot_id: BOT, key: "loyalty_earn_percent", value: "10" });
    // 1000 ₽ = 5000 ₸, 10 % = 500 баллов.
    expect(await awardPointsForOrder(ctx, 5, TG, 1000, "RUB")).toBe(500);
    expect(points(db)).toBe(1500);
  });
});
