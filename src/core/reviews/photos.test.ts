import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import {
  checkReviewPhoto,
  parseReviewMeta,
  publicBuyerName,
  REVIEW_PHOTO_MAX_BYTES,
  reviewMetaKey,
} from "./photos";

/**
 * Отзывы с фото: лимит 3 фото держится и при альбоме Telegram (почти
 * одновременные обновления), на витрину — только одобренные продавцом,
 * удалённый товар не оставляет фото и review_meta сиротами.
 */
const stored = new Map<string, Blob>();
const removed: string[] = [];
vi.mock("@/core/db/client.server", () => ({
  serviceDb: () => ({
    storage: {
      from: (bucket: string) => ({
        upload: async (key: string, body: Blob) => {
          await Promise.resolve();
          stored.set(`${bucket}/${key}`, body);
          return { data: { path: key }, error: null };
        },
        remove: async (keys: string[]) => {
          for (const k of keys) {
            removed.push(`${bucket}/${k}`);
            stored.delete(`${bucket}/${k}`);
          }
          return { data: [], error: null };
        },
      }),
    },
  }),
}));

const {
  addReviewPhoto,
  approveLegacyReviews,
  approvedReviews,
  dropReviewExtras,
  setReviewStatus,
  reviewMeta,
} = await import("./photos.server");
const { saveComment, saveRating } = await import("./reviews");
const { deleteProduct } = await import("@/core/catalog/admin");

const BOT = "11111111-1111-1111-1111-111111111111";
const P = "22222222-2222-2222-2222-222222222222";
const R1 = "33333333-3333-3333-3333-333333333333";
const R2 = "44444444-4444-4444-4444-444444444444";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const WEBP = new TextEncoder().encode("RIFF____WEBPVP8 ");
const HTML = new TextEncoder().encode("<html><script>alert(1)</script>");

let db: FakeDb;
let ctx: TenantContext;

beforeEach(() => {
  stored.clear();
  removed.length = 0;
  db = fakeDb({ unique: { app_settings: [["bot_id", "key"]] } });
  db.tables.app_settings = [];
  db.tables.products = [{ id: P, name: "Пазл", product_images: [], product_material_files: [] }];
  db.tables.product_reviews = [
    {
      id: R1,
      product_id: P,
      telegram_id: 1,
      rating: 5,
      comment: "Отлично",
      created_at: "2026-09-20T10:00:00Z",
    },
    {
      id: R2,
      product_id: P,
      telegram_id: 2,
      rating: 2,
      comment: "Не подошло",
      created_at: "2026-09-21T10:00:00Z",
    },
  ];
  db.tables.bot_users = [
    { telegram_id: 1, first_name: "Анна", last_name: "Касымова" },
    { telegram_id: 2, first_name: "Олег", last_name: null },
  ];
  ctx = { db, tenant: { id: BOT, modules: {} } } as unknown as TenantContext;
});

describe("проверка фото", () => {
  it("тип по первым байтам: JPEG, PNG, WebP — да; HTML с именем .jpg — нет", () => {
    expect(checkReviewPhoto(JPEG)).toMatchObject({ ok: true, kind: { ext: "jpg" } });
    expect(checkReviewPhoto(PNG)).toMatchObject({ ok: true, kind: { ext: "png" } });
    expect(checkReviewPhoto(WEBP)).toMatchObject({ ok: true, kind: { ext: "webp" } });
    expect(checkReviewPhoto(HTML)).toEqual({ ok: false, reason: "type" });
  });
  it("больше 5 МБ и пустой файл — отказ по размеру", () => {
    const big = new Uint8Array(REVIEW_PHOTO_MAX_BYTES + 1);
    big.set(JPEG);
    expect(checkReviewPhoto(big)).toEqual({ ok: false, reason: "size" });
    expect(checkReviewPhoto(new Uint8Array())).toEqual({ ok: false, reason: "size" });
  });
  it("битая строка review_meta — «ждёт решения», без фото", () => {
    expect(parseReviewMeta("{oops")).toEqual({ status: "pending", photos: [] });
    expect(parseReviewMeta('{"status":"approved","photos":[1,"a"]}')).toEqual({
      status: "approved",
      photos: ["a"],
    });
  });
  it("имя на витрине — имя и первая буква фамилии", () => {
    expect(publicBuyerName("Анна Мария", "касымова")).toBe("Анна К.");
    expect(publicBuyerName("Олег", null)).toBe("Олег");
    expect(publicBuyerName("  ", "X")).toBeNull();
  });
});

describe("фото к отзыву", () => {
  it("альбом из 5 фото одновременно — сохранено ровно 3, лишние файлы удалены", async () => {
    const r = await Promise.all(
      [JPEG, PNG, WEBP, JPEG, PNG].map((f) => addReviewPhoto(ctx, 1, P, f)),
    );
    expect(r.filter((x) => x.ok)).toHaveLength(3);
    expect(r.filter((x) => !x.ok && x.reason === "limit")).toHaveLength(2);
    const meta = await reviewMeta(ctx, R1);
    expect(meta.photos).toHaveLength(3);
    expect(meta.status).toBe("pending");
    // В хранилище остались только записанные в отзыв файлы, все под префиксом магазина.
    expect([...stored.keys()].sort()).toEqual(
      meta.photos.map((p) => `product-images/${BOT}/${p}`).sort(),
    );
  });

  it("не картинка и без отзыва — ничего не сохраняется", async () => {
    expect(await addReviewPhoto(ctx, 1, P, HTML)).toEqual({ ok: false, reason: "type" });
    expect(await addReviewPhoto(ctx, 99, P, JPEG)).toEqual({ ok: false, reason: "no_review" });
    expect(stored.size).toBe(0);
    expect(db.tables.app_settings).toEqual([]);
  });
});

describe("витрина показывает только одобренные", () => {
  it("ждёт решения и скрытый — не видны; одобренный — с фото и именем", async () => {
    await addReviewPhoto(ctx, 1, P, JPEG);
    expect(await approvedReviews(ctx, P)).toEqual([]);
    await setReviewStatus(ctx, R1, "approved");
    await setReviewStatus(ctx, R2, "hidden");
    const shown = await approvedReviews(ctx, P);
    expect(shown).toHaveLength(1);
    expect(shown[0]).toMatchObject({ id: R1, rating: 5, comment: "Отлично", buyer: "Анна К." });
    expect(shown[0]!.photos[0]).toMatch(new RegExp(`^/api/img/${BOT}/`));
  });

  it("чужой путь в review_meta на витрину не попадает", async () => {
    db.tables.app_settings!.push({
      bot_id: BOT,
      key: reviewMetaKey(R1),
      value: JSON.stringify({ status: "approved", photos: ["../other-bot/secret.jpg"] }),
    });
    const [r] = await approvedReviews(ctx, P);
    expect(r!.photos).toEqual([]);
  });

  it("покупатель изменил текст — отзыв снова ждёт решения", async () => {
    await setReviewStatus(ctx, R1, "approved");
    await saveComment(ctx, 1, P, "Передумал");
    expect((await reviewMeta(ctx, R1)).status).toBe("pending");
    expect(await approvedReviews(ctx, P)).toEqual([]);
  });
});

describe("старые отзывы", () => {
  it("новая оценка сразу ждёт решения, а не считается старой", async () => {
    await saveRating(ctx, 3, P, 4);
    const id = db.tables.product_reviews!.find((r) => r.telegram_id === 3)!.id as string;
    const row = db.tables.app_settings!.find((s) => s.key === reviewMetaKey(id));
    expect(parseReviewMeta(row?.value as string)).toEqual({ status: "pending", photos: [] });
  });

  it("«Одобрить все старые» показывает только отзывы без решения", async () => {
    await setReviewStatus(ctx, R2, "hidden");
    await saveRating(ctx, 3, P, 4);
    expect(await approveLegacyReviews(ctx)).toBe(1);
    expect((await reviewMeta(ctx, R1)).status).toBe("approved");
    expect((await reviewMeta(ctx, R2)).status).toBe("hidden");
    expect((await approvedReviews(ctx, P)).map((r) => r.id)).toEqual([R1]);
    // Повторное нажатие ничего не меняет.
    expect(await approveLegacyReviews(ctx)).toBe(0);
  });
});

describe("удаление", () => {
  it("товар удалён — фото его отзывов и review_meta удаляются следом", async () => {
    await addReviewPhoto(ctx, 1, P, JPEG);
    await addReviewPhoto(ctx, 2, P, PNG);
    await setReviewStatus(ctx, R2, "approved");
    const photos = [
      ...(await reviewMeta(ctx, R1)).photos,
      ...(await reviewMeta(ctx, R2)).photos,
    ].map((p) => `product-images/${BOT}/${p}`);
    db.tables.app_settings!.push({ bot_id: BOT, key: "shop_name", value: "Магазин" });
    await deleteProduct(ctx, P);
    expect(removed).toEqual(expect.arrayContaining(photos));
    expect(stored.size).toBe(0);
    expect(db.tables.app_settings!.map((s) => s.key)).toEqual(["shop_name"]);
  });

  it("dropReviewExtras без отзывов ничего не делает", async () => {
    await dropReviewExtras(ctx, []);
    expect(removed).toEqual([]);
  });
});
