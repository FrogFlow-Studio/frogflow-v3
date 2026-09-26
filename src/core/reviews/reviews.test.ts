import { describe, expect, it } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { reviewableProductsForOrder, saveComment, saveRating } from "./reviews";

const BOT = "11111111-1111-1111-1111-111111111111";

/** Позиции лежат прямо в строке заказа: так fakeDb отдаёт вложенный select «order_items(...)». */
function ordersDb(orders: Array<Record<string, unknown>>): FakeDb {
  const db = fakeDb();
  db.tables.orders = orders;
  return db;
}
const ctxOf = (db: unknown) => ({ tenant: { id: BOT }, db }) as unknown as TenantContext;

const delivered = {
  id: 1,
  status: "delivered",
  telegram_id: 555,
  order_items: [
    { product_id: "p1", name_snapshot: "Материал 1" },
    { product_id: "p1", name_snapshot: "Материал 1" },
    { product_id: null, name_snapshot: "Удалённый товар" },
    { product_id: "p2", name_snapshot: "Материал 2" },
  ],
};

describe("отзывы: опись v1 (tests/reviews-server.test.ts)", () => {
  it("возвращает уникальные товары доставленного заказа этого покупателя", async () => {
    const ctx = ctxOf(ordersDb([delivered]));
    expect(await reviewableProductsForOrder(ctx, 1, 555)).toEqual([
      { productId: "p1", name: "Материал 1" },
      { productId: "p2", name: "Материал 2" },
    ]);
  });

  it("чужой заказ или недоставленный — пустой список", async () => {
    const ctx = ctxOf(ordersDb([{ ...delivered, status: "awaiting_payment" }]));
    expect(await reviewableProductsForOrder(ctx, 1, 555)).toEqual([]);
    const other = ctxOf(ordersDb([delivered]));
    expect(await reviewableProductsForOrder(other, 1, 999)).toEqual([]);
    expect(await reviewableProductsForOrder(other, 2, 555)).toEqual([]);
  });

  it("updateReviewComment для несуществующей оценки — false, без побочных эффектов", async () => {
    const db = fakeDb();
    db.tables.product_reviews = [];
    const ctx = ctxOf(db);
    expect(await saveComment(ctx, 555, "no-such-product", "текст")).toBe(false);
    expect(db.tables.product_reviews).toEqual([]);

    expect(await saveRating(ctx, 555, "p1", 5)).toBe(true);
    expect(await saveComment(ctx, 555, "p1", "  Отличный материал!  ")).toBe(true);
    expect(db.tables.product_reviews).toMatchObject([
      { telegram_id: 555, product_id: "p1", rating: 5, comment: "Отличный материал!" },
    ]);
  });
});
