/**
 * Страница «Отзывы» (shop16-reviews.spec.ts): магазин «Кондитерская О16» с 45 отзывами —
 * 40 одобренных пятёрок на торт и 5 старых отзывов на пирог (оценка 1, решения продавца нет).
 */
import * as F from "../fixtures.ts";
import type { StubDb } from "../pg-stub.ts";
import { add, encrypt, hash, nulls } from "./util.ts";

const own = <T extends object>(r: T) => ({ bot_id: F.REV16_SHOP_ID, ...r });
const rid = (n: number) => `e2e00000-0000-4000-8000-${String(n).padStart(12, "0")}`;

export function seedShop16Reviews(db: StubDb, now: string) {
  add(db, "bots", [
    {
      id: F.REV16_SHOP_ID,
      bot_name: F.REV16_SHOP_NAME,
      status: "active",
      vertical: "digital",
      modules: { shop: true, review_request: true },
      settings: {
        served_by: "v2",
        default_locale: "ru",
        slug: F.REV16_SHOP_SLUG,
        telegram: { username: "e2e_rev16_bot", webhook_ok: true },
        admin: { username: F.REV16_SELLER_LOGIN, password_hash: hash(F.REV16_SELLER_PASSWORD) },
      },
      paused_message: null,
      owner_telegram_id: 500000116,
      owner_name: "Продавец О16",
      app_url: null,
      archived_at: null,
      bot_token: encrypt("700000116:E2E-rev16-token", F.SECRETS_KEY),
      subscription_plan: "business",
      subscription_expires_at: null,
      created_at: now,
    },
  ]);
  add(db, "app_settings", [own({ key: "shop_name", value: F.REV16_SHOP_NAME, updated_at: now })]);
  const product = (id: string, name: string, sort: number) =>
    own({
      id,
      name,
      description: "Свежая выпечка.",
      price: 5000,
      currency: "KZT",
      country_prices: {},
      is_active: true,
      category_ids: [],
      fulfillment_kind: "physical",
      stock_quantity: null,
      lead_time_days: null,
      ...nulls([
        "file_path",
        "file_name",
        "file_url",
        "file_path_kz",
        "file_name_kz",
        "file_url_kz",
        "rating_avg",
      ]),
      rating_count: 0,
      sort_order: sort,
      created_at: now,
    });
  add(db, "products", [
    product(F.REV16_CAKE_ID, F.REV16_CAKE_NAME, 0),
    product(F.REV16_PIE_ID, F.REV16_PIE_NAME, 1),
  ]);
  const total = F.REV16_CAKE_REVIEWS + F.REV16_PIE_REVIEWS;
  const reviews = Array.from({ length: total }, (_, i) => {
    const cake = i < F.REV16_CAKE_REVIEWS;
    // свежее время у меньшего номера: порядок на странице предсказуем
    const at = new Date(Date.parse(now) - i * 60_000).toISOString();
    return own({
      id: rid(0x1600 + i),
      product_id: cake ? F.REV16_CAKE_ID : F.REV16_PIE_ID,
      telegram_id: 910000 + i,
      rating: cake ? 5 : 1,
      comment: `Отзыв номер ${i + 1}`,
      created_at: at,
      updated_at: at,
    });
  });
  add(db, "product_reviews", reviews);
  add(
    db,
    "app_settings",
    reviews.slice(0, F.REV16_CAKE_REVIEWS).map((r) =>
      own({
        key: `review_meta:${r.id}`,
        value: '{"status":"approved","photos":[]}',
        updated_at: now,
      }),
    ),
  );
}
