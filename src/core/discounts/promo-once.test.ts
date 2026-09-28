import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Customer } from "@/core/customers/customers";
import { placeOrder } from "@/core/orders/orders";
import { findValidPromoCode } from "./discounts";
import { PROMO_ONCE_KEY, parsePromoOnce, promoOnceIds, setPromoOnce } from "./promo-once";

/** Промокод «один раз на покупателя»: флаг в app_settings, проверка по заказам покупателя. */
const BOT = "11111111-1111-1111-1111-111111111111";
const TG = 777;

function setup(once = true) {
  const db = fakeDb({ unique: { app_settings: [["bot_id", "key"]] } });
  db.rpc = async () => ({ data: true, error: null });
  db.tables.app_settings = once
    ? [{ bot_id: BOT, key: PROMO_ONCE_KEY, value: JSON.stringify(["promo-1"]) }]
    : [];
  db.tables.bot_users = [{ telegram_id: TG, user_key: `tg:${TG}`, loyalty_points: 0, state: {} }];
  db.tables.payment_methods = [
    { id: "pm-1", country_code: "KZ", country_name: "Казахстан", is_active: true, sort_order: 1 },
  ];
  db.tables.promo_codes = [
    {
      id: "promo-1",
      bot_id: BOT,
      code: "WELCOME",
      discount_type: "percent",
      discount_value: 10,
      used_count: 0,
      max_uses: null,
      valid_until: null,
      is_active: true,
    },
  ];
  db.tables.orders = [];
  const ctx = {
    tenant: { id: BOT, modules: { coupons: true }, settings: {} },
    db,
  } as unknown as TenantContext;
  return { db, ctx };
}

const buyer = (over: Partial<Customer> = {}): Customer => ({
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
  ...over,
});

const cart = (db: ReturnType<typeof fakeDb>) => {
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
        price: 500,
        currency: "KZT",
        fulfillment_kind: "digital",
        file_path: `${BOT}/m.pdf`,
      },
      product_variants: null,
    },
  ];
};

describe("промокод «один раз на покупателя»", () => {
  it("второй заказ того же покупателя с кодом — отказ, другой покупатель — может", async () => {
    const { db, ctx } = setup();
    cart(db);
    const first = await placeOrder(ctx, buyer(), "KZ", { promoCode: "welcome" });
    expect(first.ok).toBe(true);
    cart(db);
    const second = await placeOrder(ctx, buyer(), "KZ", { promoCode: "WELCOME" });
    expect(second).toMatchObject({ ok: false, reason: "promo_used" });
    expect(await findValidPromoCode(ctx, "welcome", buyer())).toEqual({
      ok: false,
      reason: "used_by_buyer",
    });
    const other = buyer({ userKey: "tg:888", telegramId: 888 });
    expect((await findValidPromoCode(ctx, "welcome", other)).ok).toBe(true);
    // Без покупателя (превью продавца) правило не проверяется.
    expect((await findValidPromoCode(ctx, "welcome")).ok).toBe(true);
  });

  it("отменённый или отклонённый заказ использованием не считается", async () => {
    const { db, ctx } = setup();
    db.tables.orders = [
      { id: 1, user_key: `tg:${TG}`, promo_code: "WELCOME", status: "cancelled" },
      { id: 2, user_key: `tg:${TG}`, promo_code: "WELCOME", status: "rejected" },
    ];
    expect((await findValidPromoCode(ctx, "welcome", buyer())).ok).toBe(true);
    db.tables.orders.push({ id: 3, user_key: `tg:${TG}`, promo_code: "WELCOME", status: "paid" });
    expect((await findValidPromoCode(ctx, "welcome", buyer())).ok).toBe(false);
  });

  it("покупатель сайта: та же почта в заказе (вход через Telegram) — уже использован", async () => {
    const { db, ctx } = setup();
    db.tables.orders = [
      {
        id: 1,
        user_key: `tg:${TG}`,
        promo_code: "WELCOME",
        status: "delivered",
        customer_email: "anna@mail.ru",
      },
    ];
    const web = buyer({ userKey: "web_abc", platform: "web", email: "Anna@mail.ru" });
    expect(await findValidPromoCode(ctx, "welcome", web)).toMatchObject({
      reason: "used_by_buyer",
    });
    const otherEmail = buyer({ userKey: "web_def", platform: "web", email: "olga@mail.ru" });
    expect((await findValidPromoCode(ctx, "welcome", otherEmail)).ok).toBe(true);
  });

  it("флаг не прочитался — сбой, а не «можно ещё раз»", async () => {
    const { db, ctx } = setup();
    db.tables.orders = [{ id: 1, user_key: `tg:${TG}`, promo_code: "WELCOME", status: "paid" }];
    const from = db.from.bind(db);
    const broken = {
      ...ctx,
      db: {
        ...db,
        from: (table: string) =>
          table === "app_settings"
            ? {
                select: () => ({
                  eq: () => ({
                    maybeSingle: async () => ({ data: null, error: { message: "timeout" } }),
                  }),
                }),
              }
            : from(table),
      },
    } as unknown as TenantContext;
    const { isPlatformFailure } = await import("@/lib/server-fn-errors");
    const err = await findValidPromoCode(broken, "welcome", buyer()).catch((e) => e);
    expect(isPlatformFailure(err)).toBe(true);
  });

  it("без флага код можно брать сколько угодно раз", async () => {
    const { db, ctx } = setup(false);
    db.tables.orders = [{ id: 1, user_key: `tg:${TG}`, promo_code: "WELCOME", status: "paid" }];
    expect((await findValidPromoCode(ctx, "welcome", buyer())).ok).toBe(true);
  });

  it("флаг включается и снимается атомарно, повтор ничего не меняет", async () => {
    const { ctx } = setup(false);
    expect(await setPromoOnce(ctx, "promo-1", true)).toBe(true);
    expect(await setPromoOnce(ctx, "promo-2", true)).toBe(true);
    expect(await setPromoOnce(ctx, "promo-1", true)).toBe(true);
    expect([...(await promoOnceIds(ctx))]).toEqual(["promo-1", "promo-2"]);
    await setPromoOnce(ctx, "promo-1", false);
    expect([...(await promoOnceIds(ctx))]).toEqual(["promo-2"]);
    expect(parsePromoOnce("мусор")).toEqual([]);
    expect(parsePromoOnce('{"a":1}')).toEqual([]);
  });
});
