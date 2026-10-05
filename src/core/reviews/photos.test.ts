import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import {
  checkReviewPhoto,
  parseReviewMeta,
  publicBuyerName,
  REVIEW_PHOTO_MAX_BYTES,
  REVIEW_REPLY_MAX,
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
  approvedRating,
  addReviewPhoto,
  approveLegacyReviews,
  approvedReviews,
  approvedReviewsPage,
  approvedRatings,
  dropReviewExtras,
  setReviewStatus,
  markReviewReplied,
  clearPublicReply,
  reviewMeta,
} = await import("./photos.server");
const { saveComment, saveRating } = await import("./reviews");
const { deleteProduct } = await import("@/core/catalog/admin");

const BOT = "11111111-1111-1111-1111-111111111111";
const P = "22222222-2222-2222-2222-222222222222";
const R1 = "33333333-3333-3333-3333-333333333333";
const R2 = "44444444-4444-4444-4444-444444444444";
const Q = "66666666-6666-4666-8666-666666666666";

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

describe("отметка об ответе продавца", () => {
  it("ставится и переживает решение продавца и новое фото", async () => {
    await setReviewStatus(ctx, R1, "approved");
    expect((await reviewMeta(ctx, R1)).repliedAt).toBeUndefined();
    expect(await markReviewReplied(ctx, R1)).toBe(true);
    await setReviewStatus(ctx, R1, "hidden");
    await addReviewPhoto(ctx, 1, P, JPEG);
    const m = await reviewMeta(ctx, R1);
    expect(typeof m.repliedAt).toBe("string");
    expect(m.photos).toHaveLength(1);
    expect(m.status).toBe("pending");
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

describe("публичный ответ продавца", () => {
  it("виден на витрине только у одобренного отзыва, личный ответ в ленту не попадает", async () => {
    await markReviewReplied(ctx, R1, "Спасибо за отзыв!");
    // Решения ещё нет: ответ сохранён, витрина отзыв не показывает вовсе.
    expect(await approvedReviews(ctx, P)).toEqual([]);
    await setReviewStatus(ctx, R1, "approved");
    await setReviewStatus(ctx, R2, "approved");
    await markReviewReplied(ctx, R2, null);
    const shown = await approvedReviews(ctx, P);
    expect(shown.find((r) => r.id === R1)!.reply).toBe("Спасибо за отзыв!");
    expect(shown.find((r) => r.id === R2)!.reply).toBeNull();
    expect((await reviewMeta(ctx, R2)).repliedAt).toBeTruthy();
    // Скрыли отзыв — ответ вместе с ним уходит с витрины.
    await setReviewStatus(ctx, R1, "hidden");
    expect((await approvedReviews(ctx, P)).map((r) => r.id)).toEqual([R2]);
  });

  it("ответ переживает смену решения и правку фото; убирается отдельно, отметка «отвечено» остаётся", async () => {
    await markReviewReplied(ctx, R1, "Ответ");
    await setReviewStatus(ctx, R1, "approved");
    await addReviewPhoto(ctx, 1, P, JPEG);
    await setReviewStatus(ctx, R1, "approved");
    expect((await reviewMeta(ctx, R1)).reply).toBe("Ответ");
    expect(await clearPublicReply(ctx, R1)).toBe(true);
    const m = await reviewMeta(ctx, R1);
    expect(m.reply).toBeUndefined();
    expect(m.repliedAt).toBeTruthy();
    // Повторное снятие ничего не пишет и не падает.
    expect(await clearPublicReply(ctx, R1)).toBe(true);
  });

  it("личный ответ после публичного не стирает публичный; текст режется по REVIEW_REPLY_MAX", async () => {
    await markReviewReplied(ctx, R1, "Публично");
    await markReviewReplied(ctx, R1, null);
    expect((await reviewMeta(ctx, R1)).reply).toBe("Публично");
    await markReviewReplied(ctx, R1, "я".repeat(REVIEW_REPLY_MAX + 50));
    expect((await reviewMeta(ctx, R1)).reply).toHaveLength(REVIEW_REPLY_MAX);
  });

  it("два ответа одновременно: остаётся один из них целиком, решение не теряется", async () => {
    await setReviewStatus(ctx, R1, "approved");
    await Promise.all([markReviewReplied(ctx, R1, "Первый"), markReviewReplied(ctx, R1, "Второй")]);
    const m = await reviewMeta(ctx, R1);
    expect(["Первый", "Второй"]).toContain(m.reply);
    expect(m.status).toBe("approved");
  });
});

describe("отзывы витрины: страницы, фильтры, оценка", () => {
  const rid = (n: number) => `55555555-5555-4555-8555-${String(n).padStart(12, "0")}`;
  /** 25 отзывов: свежее — меньший номер; оценка 1 + n % 5; одобрены все, кроме каждого 7-го (скрыт), фото у каждого 4-го. */
  function seed25() {
    db.tables.product_reviews = [];
    db.tables.app_settings = [];
    for (let n = 1; n <= 25; n++) {
      const id = rid(n);
      db.tables.product_reviews!.push({
        id,
        product_id: P,
        telegram_id: 1,
        rating: 1 + (n % 5),
        comment: `Отзыв ${n}`,
        created_at: new Date(Date.UTC(2026, 8, 30, 12, 0) - n * 60_000).toISOString(),
      });
      const photos =
        n % 4 === 0 ? [`reviews/${id}/${"a".repeat(8)}-aaaa-4aaa-8aaa-${"b".repeat(12)}.jpg`] : [];
      db.tables.app_settings!.push({
        bot_id: BOT,
        key: reviewMetaKey(id),
        value: JSON.stringify({ status: n % 7 === 0 ? "hidden" : "approved", photos }),
      });
    }
  }
  const nums = (items: Array<{ id: string }>) => items.map((r) => Number(r.id.slice(-12)));

  it("страницы по 10 без повторов и пропусков; скрытые не считаются; последняя без «ещё»", async () => {
    seed25();
    const p1 = await approvedReviewsPage(ctx, P);
    const p2 = await approvedReviewsPage(ctx, P, { offset: 10 });
    const p3 = await approvedReviewsPage(ctx, P, { offset: 20 });
    const all = [...nums(p1.items), ...nums(p2.items), ...nums(p3.items)];
    const approved = Array.from({ length: 25 }, (_, i) => i + 1).filter((n) => n % 7 !== 0);
    expect(all).toEqual(approved);
    expect([p1.hasMore, p2.hasMore, p3.hasMore]).toEqual([true, true, false]);
    expect(p3.items).toHaveLength(approved.length - 20);
  });

  it("фильтры «с фото» и по оценке работают вместе и считаются среди одобренных", async () => {
    seed25();
    const photo = await approvedReviewsPage(ctx, P, { withPhoto: true });
    expect(nums(photo.items)).toEqual([4, 8, 12, 16, 20, 24]); // 28 нет; 7-й скрыт, но он без фото
    expect(photo.items.every((r) => r.photos.length === 1)).toBe(true);
    const five = await approvedReviewsPage(ctx, P, { rating: 5 });
    expect(five.items.every((r) => r.rating === 5)).toBe(true);
    expect(nums(five.items)).toEqual([4, 9, 19, 24]); // 14 скрыт (кратно 7)
    const both = await approvedReviewsPage(ctx, P, { rating: 5, withPhoto: true });
    expect(nums(both.items)).toEqual([4, 24]);
    expect(await approvedReviewsPage(ctx, P, { rating: 5, offset: 100 })).toEqual({
      items: [],
      hasMore: false,
    });
  });

  it("пометка «покупка подтверждена»: только выданный заказ этого магазина с этим товаром", async () => {
    for (const id of [R1, R2]) {
      db.tables.app_settings!.push({
        bot_id: BOT,
        key: reviewMetaKey(id),
        value: JSON.stringify({ status: "approved", photos: [] }),
      });
    }
    db.tables.orders = [
      { id: 1, bot_id: BOT, telegram_id: 1, status: "delivered" },
      { id: 2, bot_id: BOT, telegram_id: 2, status: "cancelled" },
      { id: 3, bot_id: "other", telegram_id: 2, status: "delivered" },
    ];
    db.tables.order_items = [
      { order_id: 1, product_id: P },
      { order_id: 2, product_id: P },
      { order_id: 3, product_id: P },
    ];
    const { items } = await approvedReviewsPage(ctx, P);
    expect(items.map((r) => [r.id, r.confirmed])).toEqual([
      [R2, false],
      [R1, true],
    ]);
  });

  it("оценка: пакетно по товарам и поштучно — одно число; скрытые и без решения не в счёт", async () => {
    seed25();
    db.tables.products!.push({ id: Q, name: "Пазл 2" });
    db.tables.product_reviews!.push({
      id: rid(900),
      product_id: Q,
      telegram_id: 1,
      rating: 1,
      comment: null,
      created_at: "2026-09-01T00:00:00Z",
    });
    const ratings = await approvedRatings(ctx, [P, Q]);
    const approved = Array.from({ length: 25 }, (_, i) => i + 1).filter((n) => n % 7 !== 0);
    const sum = approved.reduce((a, n) => a + 1 + (n % 5), 0);
    expect(ratings.get(P)).toEqual({
      avg: Math.round((sum / approved.length) * 10) / 10,
      count: approved.length,
    });
    // У Q единственный отзыв без решения продавца — оценки нет.
    expect(ratings.has(Q)).toBe(false);
    expect(await approvedRating(ctx, P)).toEqual(ratings.get(P));
    expect(await approvedRating(ctx, Q)).toBeNull();
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
    expect(await approveLegacyReviews(ctx)).toEqual({ approved: 1, remaining: 0 });
    expect((await reviewMeta(ctx, R1)).status).toBe("approved");
    expect((await reviewMeta(ctx, R2)).status).toBe("hidden");
    expect((await approvedReviews(ctx, P)).map((r) => r.id)).toEqual([R1]);
    // Повторное нажатие ничего не меняет.
    expect(await approveLegacyReviews(ctx)).toEqual({ approved: 0, remaining: 0 });
  });
});

describe("старые отзывы: 2 000 штук и бюджет времени", () => {
  it("итог правдив, повтор доделывает остаток, решённые не трогаются", async () => {
    const ids = Array.from({ length: 2000 }, (_, i) => `legacy-${String(i).padStart(4, "0")}`);
    db.tables.product_reviews = ids.map((id) => ({
      id,
      product_id: P,
      telegram_id: 500,
      rating: 5,
      comment: null,
    }));
    // Один отзыв продавец уже скрыл: «Одобрить все» его не трогает и в остаток не входит.
    db.tables.app_settings!.push({
      bot_id: BOT,
      key: reviewMetaKey(ids[7]!),
      value: JSON.stringify({ status: "hidden", photos: [] }),
    });
    // Часы: каждая проверка времени — одна «миллисекунда»; бюджет — 1 200 проверок.
    const clock = () => {
      let t = 0;
      return () => t++;
    };
    const first = await approveLegacyReviews(ctx, { budgetMs: 1200, now: clock() });
    expect(first.approved + first.remaining).toBe(1999);
    expect(first.approved).toBeGreaterThan(0);
    expect(first.remaining).toBeGreaterThan(0);
    const metaRows = () =>
      db.tables.app_settings!.filter((s) => String(s.key).startsWith("review_meta:legacy-"));
    expect(metaRows()).toHaveLength(first.approved + 1);

    const second = await approveLegacyReviews(ctx, { budgetMs: 1_000_000, now: clock() });
    expect(second).toEqual({ approved: first.remaining, remaining: 0 });
    expect(metaRows()).toHaveLength(2000);
    expect((await reviewMeta(ctx, ids[7]!)).status).toBe("hidden");
    // Третье нажатие — ничего нового.
    expect(await approveLegacyReviews(ctx)).toEqual({ approved: 0, remaining: 0 });
  });
});

describe("оценка для поиска", () => {
  it("считаются только одобренные отзывы", async () => {
    expect(await approvedRating(ctx, P)).toBeNull();
    await setReviewStatus(ctx, R1, "approved");
    expect(await approvedRating(ctx, P)).toEqual({ avg: 5, count: 1 });
    await setReviewStatus(ctx, R2, "approved");
    expect(await approvedRating(ctx, P)).toEqual({ avg: 3.5, count: 2 });
    await setReviewStatus(ctx, R1, "hidden");
    expect(await approvedRating(ctx, P)).toEqual({ avg: 2, count: 1 });
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
    db.tables.app_settings!.push({ bot_id: BOT, key: `cost:${P}`, value: '{"p":100}' });
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
