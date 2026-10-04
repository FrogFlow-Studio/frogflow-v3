/**
 * Отзывы на витрине (shop16-o-filters.spec.ts): «Торт О6» с 14 отзывами — 12 одобренных
 * (нечётные — пятёрки, чётные — четвёрки; фото у 3-го, 6-го и 9-го), 13-й скрыт, 14-й ждёт решения.
 */
import * as F from "../fixtures.ts";
import type { StubDb } from "../pg-stub.ts";
import { add, encrypt, nulls } from "./util.ts";

const own = <T extends object>(r: T) => ({ bot_id: F.FLT16_SHOP_ID, ...r });
const rid = (n: number) => `e2e00000-0000-4000-8000-${String(n).padStart(12, "0")}`;

export function seedShop16OFilters(db: StubDb, now: string) {
  add(db, "bots", [
    {
      id: F.FLT16_SHOP_ID,
      bot_name: F.FLT16_SHOP_NAME,
      status: "active",
      vertical: "digital",
      modules: { shop: true, web_storefront: true, review_request: true },
      settings: {
        served_by: "v2",
        default_locale: "ru",
        slug: F.FLT16_SHOP_SLUG,
        telegram: { username: "e2e_flt16_bot", webhook_ok: true },
      },
      paused_message: null,
      owner_telegram_id: 500000416,
      owner_name: "Продавец О6",
      app_url: null,
      archived_at: null,
      bot_token: encrypt("700000416:E2E-flt16-token", F.SECRETS_KEY),
      subscription_plan: "business",
      subscription_expires_at: null,
      created_at: now,
    },
  ]);
  add(db, "products", [
    own({
      id: F.FLT16_PRODUCT_ID,
      name: F.FLT16_PRODUCT_NAME,
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
      ]),
      // Колонки считают все 14 отзывов подряд: (6·5 + 6·4 + 1 + 1) / 14 = 4.0.
      rating_avg: 4.0,
      rating_count: 14,
      sort_order: 0,
      created_at: now,
    }),
  ]);
  const reviews = Array.from({ length: 14 }, (_, i) => {
    const n = i + 1;
    const at = new Date(Date.parse(now) - n * 60_000).toISOString();
    return own({
      id: rid(0x1660 + n),
      product_id: F.FLT16_PRODUCT_ID,
      telegram_id: 930000 + n,
      rating: n <= 12 ? (n % 2 ? 5 : 4) : 1,
      comment: `Отзыв витрины ${n}`,
      created_at: at,
      updated_at: at,
    });
  });
  add(db, "product_reviews", reviews);
  add(db, "app_settings", [
    own({ key: "shop_name", value: F.FLT16_SHOP_NAME, updated_at: now }),
    ...reviews.map((r, i) => {
      const n = i + 1;
      const photos = [3, 6, 9].includes(n)
        ? [`reviews/${r.id}/aaaaaaaa-aaaa-4aaa-8aaa-bbbbbbbbbbbb.jpg`]
        : [];
      const status = n <= 12 ? "approved" : n === 13 ? "hidden" : "pending";
      return own({
        key: `review_meta:${r.id}`,
        value: JSON.stringify({ status, photos }),
        updated_at: now,
      });
    }),
  ]);
}
