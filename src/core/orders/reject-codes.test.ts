import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Customer } from "@/core/customers/customers";
import { placeOrder, rejectOrder } from "@/core/orders/orders";
import { expireWebOrders } from "@/core/storefront/web-expire";

/**
 * Отмена неоплаченного заказа (срок жизни заказа с сайта или продавец, пока
 * заказ ждёт оплаты) возвращает промокод и сертификат ровно один раз: иначе
 * брошенное оформление сжигает сертификат покупателя, а промокод с лимитом
 * можно исчерпать, бросая оформления.
 */
const BOT = "11111111-1111-1111-1111-111111111111";
const TG = 777;

// Покупатель с 100 баллами и товаром за 500 в корзине, модуль баллов включён.
function setup() {
  const db = fakeDb();
  // claim_order_placement: захват оформления удаётся.
  db.rpc = async () => ({ data: true, error: null });
  db.tables.bot_users = [{ telegram_id: TG, user_key: `tg:${TG}`, loyalty_points: 100, state: {} }];
  db.tables.payment_methods = [
    { id: "pm-1", country_code: "KZ", country_name: "Казахстан", is_active: true, sort_order: 1 },
  ];
  db.tables.cart_items = [
    {
      id: "c-1",
      telegram_id: TG,
      quantity: 1,
      product_variant_id: null,
      created_at: "2026-09-26T00:00:00Z",
      // Встроенный join PostgREST: строка корзины приходит вместе с товаром.
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
  db.tables.promo_codes = [
    {
      id: "promo-1",
      bot_id: BOT,
      code: "E2E10",
      discount_type: "percent",
      discount_value: 10,
      used_count: 4,
      max_uses: 5,
      valid_until: null,
      is_active: true,
    },
  ];
  db.tables.gift_certificates = [
    {
      id: "gift-1",
      bot_id: BOT,
      code: "GIFT-AAAA2222",
      amount: 200,
      currency: "KZT",
      status: "active",
      note: null,
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
    loyaltyPoints: 100,
    state: {},
    zernioConversationId: null,
    zernioAccountId: null,
  };
  return { db, ctx, customer };
}

const codes = { promoCode: "e2e10", giftCode: "gift-aaaa2222" };

describe("возврат промокода и сертификата при отмене неоплаченного заказа", () => {
  it("отмена по сроку: сертификат снова активен, счётчик промокода уменьшен — один раз", async () => {
    const { db, ctx, customer } = setup();
    const r = await placeOrder(ctx, customer, "KZ", codes);
    if (!r.ok) throw new Error(`не оформился: ${r.reason}`);
    expect(db.tables.promo_codes![0]!.used_count).toBe(5);
    expect(db.tables.gift_certificates![0]).toMatchObject({
      status: "redeemed",
      redeemed_order_id: r.order.id,
    });
    Object.assign(db.tables.orders![0]!, {
      platform: "web",
      payment_proof_path: null,
      created_at: "2026-09-20T00:00:00Z",
    });
    db.tables.order_items = [];
    const [a, b] = await Promise.all([
      expireWebOrders(ctx, new Date("2026-09-27T00:00:00Z")),
      expireWebOrders(ctx, new Date("2026-09-27T00:00:00Z")),
    ]);
    expect(a.cancelled + b.cancelled).toBe(1);
    expect(db.tables.promo_codes![0]!.used_count).toBe(4);
    expect(db.tables.gift_certificates![0]).toMatchObject({
      status: "active",
      redeemed_order_id: null,
      redeemed_by_telegram_id: null,
      redeemed_at: null,
    });
    await expireWebOrders(ctx, new Date("2026-09-27T01:00:00Z"));
    expect(db.tables.promo_codes![0]!.used_count).toBe(4);
  });

  it("продавец отклонил заказ, который ждал оплаты, — коды возвращаются", async () => {
    const { db, ctx, customer } = setup();
    const r = await placeOrder(ctx, customer, "KZ", codes);
    if (!r.ok) throw new Error("не оформился");
    expect(await rejectOrder(ctx, r.order.id, "admin")).toBe(true);
    expect(db.tables.promo_codes![0]!.used_count).toBe(4);
    expect(db.tables.gift_certificates![0]!.status).toBe("active");
  });

  it("заказ уже с чеком или оплачен — при отклонении коды остаются погашенными", async () => {
    for (const status of ["awaiting_confirmation", "paid"]) {
      const { db, ctx, customer } = setup();
      const r = await placeOrder(ctx, customer, "KZ", codes);
      if (!r.ok) throw new Error("не оформился");
      db.tables.orders![0]!.status = status;
      expect(await rejectOrder(ctx, r.order.id, "admin")).toBe(true);
      expect(db.tables.orders![0]!.status).toBe("rejected");
      expect(db.tables.promo_codes![0]!.used_count).toBe(5);
      expect(db.tables.gift_certificates![0]!.status).toBe("redeemed");
    }
  });

  it("ждёт оплаты, но часть уже внесена («Внести оплату») — коды остаются погашенными", async () => {
    const { db, ctx, customer } = setup();
    const r = await placeOrder(ctx, customer, "KZ", codes);
    if (!r.ok) throw new Error("не оформился");
    db.tables.orders![0]!.paid_amount = 1000;
    expect(await rejectOrder(ctx, r.order.id, "admin")).toBe(true);
    expect(db.tables.orders![0]!.status).toBe("rejected");
    expect(db.tables.promo_codes![0]!.used_count).toBe(5);
    expect(db.tables.gift_certificates![0]!.status).toBe("redeemed");
  });

  it("два нажатия «Отклонить» сразу — коды возвращаются один раз", async () => {
    const { db, ctx, customer } = setup();
    const r = await placeOrder(ctx, customer, "KZ", codes);
    if (!r.ok) throw new Error("не оформился");
    const res = await Promise.all([
      rejectOrder(ctx, r.order.id, "admin"),
      rejectOrder(ctx, r.order.id, "admin"),
    ]);
    expect(res.filter(Boolean)).toHaveLength(1);
    expect(db.tables.promo_codes![0]!.used_count).toBe(4);
    expect(await rejectOrder(ctx, r.order.id, "admin")).toBe(false);
    expect(db.tables.promo_codes![0]!.used_count).toBe(4);
  });

  it("сертификат, который уже переписан на другой заказ, не трогается", async () => {
    const { db, ctx, customer } = setup();
    const r = await placeOrder(ctx, customer, "KZ", { giftCode: codes.giftCode });
    if (!r.ok) throw new Error("не оформился");
    db.tables.gift_certificates![0]!.redeemed_order_id = 999;
    expect(await rejectOrder(ctx, r.order.id, "admin")).toBe(true);
    expect(db.tables.gift_certificates![0]).toMatchObject({
      status: "redeemed",
      redeemed_order_id: 999,
    });
  });
});

/** Запрос `op` №`nth` к `table` падает ошибкой базы, остальные идут как есть. */
function flaky(db: ReturnType<typeof fakeDb>, table: string, op: string, nth: number) {
  let n = 0;
  const broken: unknown = new Proxy(() => undefined, {
    get: (_t, prop) =>
      prop === "then"
        ? (ok: (v: unknown) => unknown) =>
            ok({ data: null, count: null, error: { message: "boom" } })
        : () => broken,
  });
  return new Proxy(db, {
    get: (t, prop, r) => {
      if (prop !== "from") return Reflect.get(t, prop, r);
      return (name: string) => {
        const q = t.from(name);
        if (name !== table) return q;
        return new Proxy(q, {
          get: (qt, qp, qr) =>
            qp === op
              ? (...args: unknown[]) =>
                  ++n === nth
                    ? broken
                    : (qt as unknown as Record<string, (...a: unknown[]) => unknown>)[op]!(...args)
              : Reflect.get(qt, qp, qr),
        });
      };
    },
  });
}

describe("сбой при возврате кодов не рвёт то, что уже сделано", () => {
  it("отклонение: возврат промокода упал — заказ всё равно отклонён, событие записано", async () => {
    const { db, ctx, customer } = setup();
    const r = await placeOrder(ctx, customer, "KZ", codes);
    if (!r.ok) throw new Error("не оформился");
    const broken = {
      ...ctx,
      db: flaky(db, "promo_codes", "select", 1),
    } as unknown as TenantContext;
    expect(await rejectOrder(broken, r.order.id, "admin")).toBe(true);
    expect(db.tables.orders![0]!.status).toBe("rejected");
    expect((db.tables.zernio_logs ?? []).some((e) => e.event_type === "order.rejected")).toBe(true);
  });

  it("оформление сорвалось, а откат сертификата упал — покупатель не застрял в «оформляется»", async () => {
    const { db, ctx, customer } = setup();
    // order_failed: вставка заказа падает; откат: второй update сертификатов тоже.
    const stage1 = flaky(db, "orders", "insert", 1);
    const stage2 = flaky(
      stage1 as unknown as ReturnType<typeof fakeDb>,
      "gift_certificates",
      "update",
      2,
    );
    const broken = { ...ctx, db: stage2 } as unknown as TenantContext;
    const res = await placeOrder(broken, customer, "KZ", { giftCode: codes.giftCode });
    expect(res).toMatchObject({ ok: false, reason: "order_failed" });
    const st = db.tables.bot_users![0]!.state as Record<string, unknown>;
    expect(st.placing_order).toBeFalsy();
  });
});
