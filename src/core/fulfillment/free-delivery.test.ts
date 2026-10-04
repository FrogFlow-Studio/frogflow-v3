import { describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Customer } from "@/core/customers/customers";
import { COPY, freeDeliveryText } from "@/channels/telegram/copy";
import {
  freeDeliveryStatus,
  goodsAfterDiscounts,
  loadFreeDeliveryRules,
  parseFreeFrom,
  parseFreeZones,
  saveFreeDeliveryRules,
  thresholdFor,
} from "./free-delivery";
import { freeDeliveryView } from "./free-delivery-cart";

vi.mock("@/lib/errors", () => ({ reportError: vi.fn(async () => {}) }));

const BOT = "11111111-1111-1111-1111-111111111111";
const TG = 5;
const Z1 = "22222222-2222-4222-8222-222222222222";
const Z2 = "33333333-3333-4333-8333-333333333333";

function ctxWith(db = fakeDb({ unique: { app_settings: [["bot_id", "key"]] } })) {
  return {
    tenant: { id: BOT, modules: { coupons: true, loyalty: true }, settings: {} },
    db,
  } as unknown as TenantContext;
}

describe("пороги бесплатной доставки", () => {
  it("разбор терпим к мусору: плохие значения — порога нет", () => {
    expect(parseFreeFrom("3000")).toBe(3000);
    expect(parseFreeFrom("2 500,5")).toBe(0);
    expect(parseFreeFrom("2500,5")).toBe(2500.5);
    for (const bad of [null, "", "0", "-5", "abc", "1e12"]) expect(parseFreeFrom(bad)).toBe(0);
    expect(parseFreeZones(JSON.stringify({ [Z1]: 2000, [Z2]: 0, nope: 100, x: "abc" }))).toEqual({
      [Z1]: 2000,
    });
    expect(parseFreeZones("{oops")).toEqual({});
    expect(parseFreeZones("[1,2]")).toEqual({});
  });

  it("порог зоны важнее общего; зона без своего — общий; ничего — 0", () => {
    const rules = { general: 5000, zones: { [Z1]: 2000 } };
    expect(thresholdFor(rules, Z1)).toBe(2000);
    expect(thresholdFor(rules, Z2)).toBe(5000);
    expect(thresholdFor(rules, null)).toBe(5000);
    expect(thresholdFor({ general: 0, zones: {} }, Z1)).toBe(0);
  });

  it("сохранение чистит чужие зоны и нули; чтение возвращает записанное", async () => {
    const ctx = ctxWith();
    await saveFreeDeliveryRules(ctx, { general: 3000, zones: { [Z1]: 2000, [Z2]: 0, zzz: 5 } }, [
      Z1,
    ]);
    expect(await loadFreeDeliveryRules(ctx)).toEqual({ general: 3000, zones: { [Z1]: 2000 } });
    await saveFreeDeliveryRules(ctx, { general: 0, zones: {} }, [Z1]);
    expect(await loadFreeDeliveryRules(ctx)).toEqual({ general: 0, zones: {} });
  });
});

describe("сколько осталось до бесплатной доставки", () => {
  const ctx = ctxWith();
  const rules = { general: 3000, zones: {} };
  it("до порога — остаток вверх до целого; на пороге и выше — бесплатно", async () => {
    expect(await freeDeliveryStatus(ctx, rules, null, { amount: 2500.4, currency: "KZT" })).toEqual(
      {
        threshold: 3000,
        remaining: 500,
        free: false,
        currency: "KZT",
      },
    );
    expect(
      (await freeDeliveryStatus(ctx, rules, null, { amount: 3000, currency: "KZT" }))?.free,
    ).toBe(true);
    expect(
      (await freeDeliveryStatus(ctx, rules, null, { amount: 3000.01, currency: "KZT" }))?.remaining,
    ).toBe(0);
  });
  it("порога нет или сумма нулевая — подсказывать нечего", async () => {
    expect(
      await freeDeliveryStatus(ctx, { general: 0, zones: {} }, null, {
        amount: 9999,
        currency: "KZT",
      }),
    ).toBeNull();
    expect(await freeDeliveryStatus(ctx, rules, null, { amount: 0, currency: "KZT" })).toBeNull();
  });
  it("товары после скидок: промокод и баллы вычитаются, сертификат нет", () => {
    expect(
      goodsAfterDiscounts({ subtotal: 3300, promo: { discount: 330 }, points: { discount: 100 } }),
    ).toBe(2870);
    expect(goodsAfterDiscounts({ subtotal: 100, promo: null, points: { discount: 500 } })).toBe(0);
  });
});

describe("подсказка про бесплатную доставку во всех языках", () => {
  it("«осталось» и «уже бесплатно» есть на ru, kk, en, uz и называют суммы", () => {
    for (const l of ["ru", "kk", "en", "uz"] as const) {
      const left = freeDeliveryText(COPY[l], {
        threshold: 3000,
        remaining: 500,
        free: false,
        currency: "KZT",
      });
      expect(left, l).toMatch(/500/);
      expect(left, l).toMatch(/3\s?000/);
      const done = freeDeliveryText(COPY[l], {
        threshold: 3000,
        remaining: 0,
        free: true,
        currency: "KZT",
      });
      expect(done, l).toMatch(/3\s?000/);
      expect(done).not.toBe(left);
      expect(COPY[l].freeWord.length).toBeGreaterThan(0);
    }
    expect(COPY.kk.freeWord).not.toBe(COPY.ru.freeWord);
    expect(COPY.en.freeWord).not.toBe(COPY.ru.freeWord);
    expect(COPY.uz.freeWord).not.toBe(COPY.ru.freeWord);
  });
});

describe("корзина бота и Instagram/WhatsApp: что видит покупатель", () => {
  function shop(o: {
    prices: number[];
    kind?: "physical" | "digital";
    delivery?: boolean;
    general?: number;
    state?: Record<string, unknown>;
  }) {
    const db = fakeDb();
    db.tables.cart_items = o.prices.map((price, i) => ({
      id: `c-${i}`,
      telegram_id: TG,
      quantity: 1,
      product_variant_id: null,
      created_at: `2026-09-26T00:00:0${i}Z`,
      products: {
        id: `p-${i}`,
        name: `Т${i}`,
        price,
        currency: "KZT",
        fulfillment_kind: o.kind ?? "physical",
      },
      product_variants: null,
    }));
    db.tables.promo_codes = [
      {
        id: "pr",
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
    db.tables.bot_users = [{ telegram_id: TG, user_key: `tg:${TG}`, loyalty_points: 0, state: {} }];
    db.tables.app_settings = [
      ...(o.general ? [{ bot_id: BOT, key: "delivery_free_from", value: String(o.general) }] : []),
      ...(o.delivery === false
        ? [{ bot_id: BOT, key: "fulfillment_delivery_enabled", value: "false" }]
        : []),
    ];
    const customer = {
      userKey: `tg:${TG}`,
      platform: "telegram",
      telegramId: TG,
      username: null,
      firstName: "А",
      lastName: null,
      languageCode: "ru",
      contactPhone: null,
      email: null,
      loyaltyPoints: 0,
      state: o.state ?? {},
      zernioConversationId: null,
      zernioAccountId: null,
    } as Customer;
    return { ctx: ctxWith(db), customer };
  }

  it("физическая корзина: осталось добрать; с промокодом остаток считается после скидки", async () => {
    const plain = shop({ prices: [2000, 500], general: 3000 });
    expect(await (await freeDeliveryView(plain.ctx, plain.customer))!.forZone(null)).toMatchObject({
      remaining: 500,
      free: false,
    });
    const withCode = shop({ prices: [2000, 500], general: 3000, state: { promo_code: "TEN" } });
    // 2500 − 10 % = 2250 → осталось 750.
    expect(
      await (await freeDeliveryView(withCode.ctx, withCode.customer))!.forZone(null),
    ).toMatchObject({ remaining: 750 });
  });

  it("нечего подсказывать: нет порога, цифровая корзина, доставка выключена, пустая корзина", async () => {
    const none = shop({ prices: [2000] });
    expect(await freeDeliveryView(none.ctx, none.customer)).toBeNull();
    const digital = shop({ prices: [2000], general: 3000, kind: "digital" });
    expect(await freeDeliveryView(digital.ctx, digital.customer)).toBeNull();
    const off = shop({ prices: [2000], general: 3000, delivery: false });
    expect(await freeDeliveryView(off.ctx, off.customer)).toBeNull();
    const empty = shop({ prices: [], general: 3000 });
    expect(await freeDeliveryView(empty.ctx, empty.customer)).toBeNull();
  });
});
