import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { clearCart } from "@/core/cart/cart";
import { activeDeliveryZones, decrementStock, recordPayment } from "@/core/fulfillment/fulfillment";
import { hasDeliveredPurchase } from "@/core/reviews/reviews";
import { getProduct } from "./catalog";
import { setProductImages } from "./admin";

const BOT = "00000000-0000-0000-0000-000000000001";

/** Запросы к `table` отвечают ошибкой базы, остальные идут в подставную базу. */
function breakTable(db: ReturnType<typeof fakeDb>, table: string) {
  const broken: unknown = new Proxy(() => undefined, {
    get: (_t, prop) =>
      prop === "then"
        ? (ok: (v: unknown) => unknown) =>
            ok({ data: null, count: null, error: { message: "boom" } })
        : () => broken,
  });
  return new Proxy(db, {
    get: (t, prop, r) =>
      prop === "from"
        ? (name: string) => (name === table ? broken : t.from(name))
        : Reflect.get(t, prop, r),
  });
}

const ctxOf = (db: unknown) =>
  ({ tenant: { id: BOT, modules: {} }, db }) as unknown as TenantContext;

describe("каталог и выдача: сбой чтения не равен «ничего нет»", () => {
  it("товар, зоны доставки, покупка для отзыва — сбой, а не null / [] / false", async () => {
    const db = fakeDb();
    await expect(getProduct(ctxOf(breakTable(db, "products")), "p1")).rejects.toThrow(/Каталог/);
    await expect(activeDeliveryZones(ctxOf(breakTable(db, "delivery_zones")))).rejects.toThrow(
      /Выдача/,
    );
    await expect(hasDeliveredPurchase(ctxOf(breakTable(db, "orders")), 1, "p1")).rejects.toThrow(
      /Отзывы/,
    );
  });

  it("остаток не списывается и оплата не записывается по упавшему чтению", async () => {
    const db = fakeDb();
    db.tables.products = [{ id: "p1", bot_id: BOT, stock_quantity: 3 }];
    db.tables.orders = [{ id: 1, bot_id: BOT, paid_amount: 0, total: 100 }];
    await expect(decrementStock(ctxOf(breakTable(db, "products")), "p1", 1)).rejects.toThrow(
      /Выдача/,
    );
    await expect(recordPayment(ctxOf(breakTable(db, "orders")), 1, 50)).rejects.toThrow(/Выдача/);
    expect(db.tables.products[0]!.stock_quantity).toBe(3);
    expect(db.tables.orders[0]!.paid_amount).toBe(0);
  });

  it("не очистили старые картинки — новые не дописываются поверх", async () => {
    const db = fakeDb();
    db.tables.product_images = [
      { id: "i1", bot_id: BOT, product_id: "p1", image_path: `${BOT}/a.jpg`, sort_order: 0 },
    ];
    await expect(
      setProductImages(ctxOf(breakTable(db, "product_images")), "p1", [`${BOT}/a.jpg`]),
    ).rejects.toThrow(/Каталог/);
    expect(db.tables.product_images).toHaveLength(1);
  });

  it("очистка корзины: сбой записи — ошибка, а не «очищено»", async () => {
    const db = fakeDb();
    await expect(
      clearCart(ctxOf(breakTable(db, "cart_items")), { telegramId: 1 } as never),
    ).rejects.toThrow(/Корзина/);
  });
});
