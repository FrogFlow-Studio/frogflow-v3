/**
 * Публичный ответ продавца (shop16-o-reply.spec.ts): один товар и три отзыва —
 * «Отзыв с ответом» (одобрен, ответ показан), «Отзыв без ответа» (одобрен) и
 * «Отзыв на проверке» (решения нет, ответ сохранён, но витрине его показывать нельзя).
 */
import * as F from "../fixtures.ts";
import type { StubDb } from "../pg-stub.ts";
import { add, encrypt, hash, nulls } from "./util.ts";

const own = <T extends object>(r: T) => ({ bot_id: F.REPLY16_SHOP_ID, ...r });
const rid = (n: number) => `e2e00000-0000-4000-8000-${String(n).padStart(12, "0")}`;

export function seedShop16OReply(db: StubDb, now: string) {
  add(db, "bots", [
    {
      id: F.REPLY16_SHOP_ID,
      bot_name: F.REPLY16_SHOP_NAME,
      status: "active",
      vertical: "digital",
      modules: { shop: true, web_storefront: true, review_request: true },
      settings: {
        served_by: "v2",
        default_locale: "ru",
        slug: F.REPLY16_SHOP_SLUG,
        telegram: { username: "e2e_reply16_bot", webhook_ok: true },
        admin: { username: F.REPLY16_SELLER_LOGIN, password_hash: hash(F.REPLY16_SELLER_PASSWORD) },
      },
      paused_message: null,
      owner_telegram_id: 500000316,
      owner_name: "Продавец О5",
      app_url: null,
      archived_at: null,
      bot_token: encrypt("700000316:E2E-reply16-token", F.SECRETS_KEY),
      subscription_plan: "business",
      subscription_expires_at: null,
      created_at: now,
    },
  ]);
  add(db, "app_settings", [own({ key: "shop_name", value: F.REPLY16_SHOP_NAME, updated_at: now })]);
  add(db, "products", [
    own({
      id: F.REPLY16_PRODUCT_ID,
      name: F.REPLY16_PRODUCT_NAME,
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
      sort_order: 0,
      created_at: now,
    }),
  ]);
  const review = (n: number, comment: string) => {
    const at = new Date(Date.parse(now) - n * 60_000).toISOString();
    return own({
      id: rid(0x1650 + n),
      product_id: F.REPLY16_PRODUCT_ID,
      telegram_id: 920000 + n,
      rating: 5,
      comment,
      created_at: at,
      updated_at: at,
    });
  };
  const reviews = [
    review(1, "Отзыв с ответом"),
    review(2, "Отзыв без ответа"),
    review(3, "Отзыв на проверке"),
  ];
  add(db, "product_reviews", reviews);
  const meta = (i: number, value: object) =>
    own({ key: `review_meta:${reviews[i]!.id}`, value: JSON.stringify(value), updated_at: now });
  add(db, "app_settings", [
    meta(0, { status: "approved", photos: [], repliedAt: now, reply: F.REPLY16_SHOWN_REPLY }),
    meta(1, { status: "approved", photos: [] }),
    meta(2, { status: "pending", photos: [], repliedAt: now, reply: F.REPLY16_HIDDEN_REPLY }),
  ]);
}
