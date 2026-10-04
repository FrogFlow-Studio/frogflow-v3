import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";

/**
 * Отзыв с сайта: только после выданного заказа с этим товаром; без заказа не остаётся
 * ни записи, ни файла; фото — только в папке своего магазина; чужой отзыв не виден.
 */
const stored = new Map<string, Blob>();
vi.mock("@/core/db/client.server", () => ({
  serviceDb: () => ({
    storage: {
      from: (bucket: string) => ({
        upload: async (key: string, body: Blob) => {
          stored.set(`${bucket}/${key}`, body);
          return { data: { path: key }, error: null };
        },
        remove: async (keys: string[]) => {
          for (const k of keys) stored.delete(`${bucket}/${k}`);
          return { data: [], error: null };
        },
      }),
    },
  }),
}));

const { submitWebReview, webReviewState } = await import("./web-review");
const { reviewMeta } = await import("./photos.server");

const BOT = "11111111-1111-1111-1111-111111111111";
const P = "22222222-2222-2222-2222-222222222222";
const OTHER_P = "55555555-5555-5555-5555-555555555555";
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const HTML = new TextEncoder().encode("<html><script>alert(1)</script>");

let db: FakeDb;
let ctx: TenantContext;

beforeEach(() => {
  stored.clear();
  db = fakeDb({ unique: { app_settings: [["bot_id", "key"]] } });
  db.tables.app_settings = [];
  db.tables.product_reviews = [];
  db.tables.orders = [
    { id: 1, bot_id: BOT, telegram_id: 7, status: "delivered" },
    { id: 2, bot_id: BOT, telegram_id: 8, status: "awaiting_payment" },
    { id: 3, bot_id: BOT, telegram_id: 9, status: "refunded" },
  ];
  db.tables.order_items = [
    { id: "i1", order_id: 1, product_id: P },
    { id: "i2", order_id: 2, product_id: P },
    { id: "i3", order_id: 3, product_id: P },
  ];
  ctx = { tenant: { id: BOT, modules: {}, settings: {} }, db } as unknown as TenantContext;
});

describe("отзыв с сайта", () => {
  it("выдан заказ с товаром: отзыв и фото сохранены, отзыв ждёт решения магазина", async () => {
    const r = await submitWebReview(ctx, 7, P, {
      rating: 5,
      comment: "  Отлично  ",
      photos: [JPEG],
    });
    expect(r).toEqual({ ok: true, photosAdded: 1, photosRejected: [] });
    expect(db.tables.product_reviews).toHaveLength(1);
    expect(db.tables.product_reviews![0]).toMatchObject({
      telegram_id: 7,
      product_id: P,
      rating: 5,
      comment: "Отлично",
    });
    const meta = await reviewMeta(ctx, db.tables.product_reviews![0]!.id as string);
    expect(meta.status).toBe("pending");
    expect(meta.photos).toHaveLength(1);
    // Фото лежит только в папке своего магазина.
    expect([...stored.keys()].every((k) => k.startsWith(`product-images/${BOT}/reviews/`))).toBe(
      true,
    );
  });

  it("заказ не выдан, оплата не подтверждена или деньги возвращены — отзыва нет, файлов нет", async () => {
    for (const tg of [8, 9, 100]) {
      expect(
        await submitWebReview(ctx, tg, P, { rating: 5, comment: "x", photos: [JPEG] }),
      ).toEqual({
        ok: false,
        reason: "no_purchase",
      });
    }
    // Выданный заказ, но другого товара.
    expect(await submitWebReview(ctx, 7, OTHER_P, { rating: 5, comment: "", photos: [] })).toEqual({
      ok: false,
      reason: "no_purchase",
    });
    expect(db.tables.product_reviews).toEqual([]);
    expect(db.tables.app_settings).toEqual([]);
    expect(stored.size).toBe(0);
  });

  it("не картинка не сохраняется, но сам отзыв остаётся; больше трёх фото не берём", async () => {
    const bad = await submitWebReview(ctx, 7, P, { rating: 4, comment: "", photos: [HTML, JPEG] });
    expect(bad).toEqual({ ok: true, photosAdded: 1, photosRejected: ["type"] });
    const many = await submitWebReview(ctx, 7, P, {
      rating: 4,
      comment: "",
      photos: [JPEG, JPEG, JPEG, JPEG],
    });
    expect(many.ok && many.photosAdded).toBe(2); // место в отзыве было на 2 фото
    expect(stored.size).toBe(3);
  });

  it("повторный отзыв обновляет прежний, а не добавляет второй", async () => {
    await submitWebReview(ctx, 7, P, { rating: 5, comment: "Хорошо", photos: [] });
    await submitWebReview(ctx, 7, P, { rating: 3, comment: "Передумал", photos: [] });
    expect(db.tables.product_reviews).toHaveLength(1);
    expect(db.tables.product_reviews![0]).toMatchObject({ rating: 3, comment: "Передумал" });
  });

  it("состояние: можно ли писать и что уже написано; чужой отзыв не виден", async () => {
    expect(await webReviewState(ctx, 7, P)).toEqual({ canReview: true, mine: null });
    expect(await webReviewState(ctx, 8, P)).toEqual({ canReview: false, mine: null });
    await submitWebReview(ctx, 7, P, { rating: 5, comment: "Супер", photos: [JPEG] });
    expect(await webReviewState(ctx, 7, P)).toEqual({
      canReview: true,
      mine: { rating: 5, comment: "Супер", status: "pending", photos: 1 },
    });
    expect((await webReviewState(ctx, 8, P)).mine).toBeNull();
  });
});
