import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Customer } from "@/core/customers/customers";
import { describeOrderEvent, listOrderEvents } from "./events";
import {
  GIFT_WRAP_KEY,
  giftWrapFee,
  giftWrapForCart,
  giftWrapName,
  isGiftWrapRow,
  loadGiftWrap,
  parseGiftWrap,
  saveGiftWrap,
} from "./gift-wrap";
import { placeOrder } from "./orders";

const BOT = "11111111-1111-1111-1111-111111111111";
const TG = 555;

function setup(
  opts: { wrap?: { on: boolean; price: number } | null; kind?: string; promo?: boolean } = {},
) {
  const db = fakeDb({ unique: { zernio_logs: [["event_id"]] } });
  db.rpc = async () => ({ data: true, error: null });
  db.tables.bot_users = [{ telegram_id: TG, user_key: `tg:${TG}`, loyalty_points: 0, state: {} }];
  db.tables.payment_methods = [
    { id: "pm-1", country_code: "KZ", country_name: "Казахстан", is_active: true, sort_order: 1 },
  ];
  db.tables.cart_items = [
    {
      id: "c-1",
      telegram_id: TG,
      quantity: 1,
      product_variant_id: null,
      created_at: "2026-10-01T00:00:00Z",
      products: {
        id: "p-1",
        name: "Торт",
        price: 5000,
        currency: "KZT",
        fulfillment_kind: opts.kind ?? "physical",
        stock_quantity: null,
      },
      product_variants: null,
    },
  ];
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
  db.tables.app_settings = opts.wrap
    ? [{ bot_id: BOT, key: GIFT_WRAP_KEY, value: JSON.stringify(opts.wrap) }]
    : [];
  const ctx = {
    tenant: { id: BOT, modules: { bundles: true, coupons: Boolean(opts.promo) }, settings: {} },
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
    state: { locale: "en" },
    zernioConversationId: null,
    zernioAccountId: null,
  };
  return { db, ctx, customer };
}

const gift = { recipient: "Анна", message: "Люблю!" };

describe("подарочная упаковка: настройка", () => {
  it("включена только с положительной ценой, мусор — выключено", () => {
    expect(parseGiftWrap('{"on":true,"price":300}')).toEqual({ on: true, price: 300 });
    expect(parseGiftWrap('{"on":true,"price":0}').on).toBe(false);
    expect(parseGiftWrap('{"on":false,"price":300}')).toEqual({ on: false, price: 300 });
    expect(parseGiftWrap("{")).toEqual({ on: false, price: 0 });
    expect(parseGiftWrap(null)).toEqual({ on: false, price: 0 });
  });

  it("сохраняется и читается обратно", async () => {
    const { ctx } = setup();
    await saveGiftWrap(ctx, { on: true, price: 450 });
    expect(await loadGiftWrap(ctx)).toEqual({ on: true, price: 450 });
    expect(await giftWrapFee(ctx, "KZT")).toBe(450);
    await saveGiftWrap(ctx, { on: false, price: 450 });
    expect(await giftWrapFee(ctx, "KZT")).toBe(0);
  });

  it("опции нет у цифрового заказа и при выключенном модуле", async () => {
    const { ctx } = setup({ wrap: { on: true, price: 300 } });
    expect(await giftWrapForCart(ctx, { kind: "physical", currency: "KZT" })).toBe(300);
    expect(await giftWrapForCart(ctx, { kind: "digital", currency: "KZT" })).toBe(0);
    (ctx.tenant.modules as Record<string, boolean>).bundles = false;
    expect(await giftWrapForCart(ctx, { kind: "physical", currency: "KZT" })).toBe(0);
  });

  it("название позиции — на языке покупателя, с меткой", () => {
    expect(giftWrapName("en")).toContain("Gift wrapping");
    expect(giftWrapName("kk")).toContain("Сыйлық қаптамасы");
    expect(giftWrapName("zz")).toContain("Подарочная упаковка");
    expect(isGiftWrapRow(giftWrapName("uz"))).toBe(true);
    expect(isGiftWrapRow("Торт")).toBe(false);
  });
});

describe("подарочная упаковка: заказ", () => {
  it("сумма с упаковкой: отдельная позиция, итог и журнал", async () => {
    const { ctx, db, customer } = setup({ wrap: { on: true, price: 300 } });
    const r = await placeOrder(ctx, customer, "KZ", { gift, giftWrap: true });
    expect(r.ok).toBe(true);
    const order = db.tables.orders![0]!;
    expect(Number(order.total)).toBe(5300);
    const items = db.tables.order_items!.filter((i) => i.order_id === order.id);
    const wrap = items.find((i) => isGiftWrapRow(String(i.name_snapshot)))!;
    expect(wrap).toMatchObject({ price_snapshot: 300, quantity: 1, product_id: null });
    expect(String(wrap.name_snapshot)).toContain("Gift wrapping");
    const ev = (await listOrderEvents(ctx, order.id as number)).find((e) => e.kind === "gift")!;
    expect(ev.payload.wrap).toBe(300);
    expect(describeOrderEvent(ev).text).toContain("подарочная упаковка +300");
  });

  it("сумма одна и та же, что в подсказке канала (giftWrapForCart)", async () => {
    const { ctx, db, customer } = setup({ wrap: { on: true, price: 300 } });
    const hint = await giftWrapForCart(ctx, { kind: "physical", currency: "KZT" });
    await placeOrder(ctx, customer, "KZ", { gift, giftWrap: true });
    expect(Number(db.tables.orders![0]!.total)).toBe(5000 + hint);
  });

  it("промокод не скидывает упаковку", async () => {
    const { ctx, db, customer } = setup({ wrap: { on: true, price: 300 }, promo: true });
    const r = await placeOrder(ctx, customer, "KZ", { gift, giftWrap: true, promoCode: "TEN" });
    expect(r.ok).toBe(true);
    // 10% от 5000 = 500; упаковка 300 сверху без скидки.
    expect(Number(db.tables.orders![0]!.total)).toBe(4500 + 300);
    expect(Number(db.tables.orders![0]!.discount_amount)).toBe(500);
  });

  it("упаковка выключена — заказ не создаётся, покупателю говорят снять её", async () => {
    const { ctx, db, customer } = setup({ wrap: { on: false, price: 300 } });
    const r = await placeOrder(ctx, customer, "KZ", { gift, giftWrap: true });
    expect(r).toEqual({ ok: false, reason: "gift_wrap_unavailable" });
    expect(db.tables.orders ?? []).toHaveLength(0);
  });

  it("без подарка или без выбора упаковки сумма прежняя", async () => {
    const a = setup({ wrap: { on: true, price: 300 } });
    await placeOrder(a.ctx, a.customer, "KZ", { gift, giftWrap: false });
    expect(Number(a.db.tables.orders![0]!.total)).toBe(5000);
    const b = setup({ wrap: { on: true, price: 300 } });
    await placeOrder(b.ctx, b.customer, "KZ", { giftWrap: true });
    expect(Number(b.db.tables.orders![0]!.total)).toBe(5000);
    expect(b.db.tables.order_items!.some((i) => isGiftWrapRow(String(i.name_snapshot)))).toBe(
      false,
    );
  });

  it("цифровой заказ упаковку не берёт", async () => {
    const { ctx, db, customer } = setup({ wrap: { on: true, price: 300 }, kind: "digital" });
    await placeOrder(ctx, customer, "KZ", { gift, giftWrap: true });
    expect(Number(db.tables.orders![0]!.total)).toBe(5000);
  });
});
