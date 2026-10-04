/**
 * «Лавка Ш» (shop20-sh-*.spec.ts): магазин на v2, согласный и одобренный на площадке, с одним
 * товаром, платёжными реквизитами и снимком товара для поиска; такой же магазин клиента прежней
 * платформы. В таблицу каталога `marketplace_shops` не добавлены, чтобы не менять счёт магазинов
 * в спецификациях каталога.
 */
import * as F from "../fixtures.ts";
import type { StubDb } from "../pg-stub.ts";
import { add, hash, nulls } from "./util.ts";

export function seedShop20Sh(db: StubDb, now: string) {
  const S = F.SH20_SHOP;
  const P = F.SH20_PRODUCT;
  add(db, "bots", [
    {
      id: S.id,
      bot_name: S.name,
      status: "active",
      vertical: "digital",
      modules: { shop: true, web_storefront: true },
      settings: {
        served_by: "v2",
        default_locale: "ru",
        slug: S.slug,
        telegram: { username: "e2e_sh20_bot", webhook_ok: true },
        admin: { username: "e2e_sh20_seller", password_hash: hash("e2e-sh20-pass-123") },
        marketplace: { listed: true, approved: true, category: "Торты", city: "Алматы" },
      },
      paused_message: null,
      owner_telegram_id: 500000220,
      owner_name: "Продавец Ш",
      app_url: null,
      archived_at: null,
      bot_token: null,
      subscription_plan: "basic",
      subscription_expires_at: null,
      created_at: now,
    },
  ]);
  add(db, "app_settings", [
    { bot_id: S.id, key: "shop_name", value: S.name, updated_at: now },
    { bot_id: S.id, key: "storefront_checkout", value: '{"enabled":true}', updated_at: now },
    {
      bot_id: S.id,
      key: `review_meta:${F.SH20_REVIEW.id}`,
      value: '{"status":"approved","photos":[]}',
      updated_at: now,
    },
  ]);
  add(db, "payment_methods", [
    {
      bot_id: S.id,
      id: "e2e20000-0000-4000-8000-0000000000b1",
      country_code: "KZ",
      country_name: "Казахстан",
      currency: "KZT",
      instructions: "Переведите сумму на Kaspi Gold 4400 1111 2222 3333 и пришлите чек.",
      qr_code_path: null,
      is_active: true,
      sort_order: 0,
      created_at: now,
    },
  ]);
  add(db, "product_reviews", [
    {
      bot_id: S.id,
      id: F.SH20_REVIEW.id,
      product_id: P.id,
      telegram_id: 900020,
      rating: 5,
      comment: F.SH20_REVIEW.comment,
      created_at: now,
      updated_at: now,
    },
  ]);
  // Снимок товаров площадки: поиск находит «Пряник Ш20» (в каталог магазинов Лавка не добавлена).
  add(db, "marketplace_items", [
    {
      bot_id: S.id,
      product_id: P.id,
      name: P.name,
      search_text: P.name.toLowerCase(),
      price: 1500,
      currency: "KZT",
      image: null,
      updated_at: now,
    },
  ]);
  add(db, "products", [
    {
      bot_id: S.id,
      id: P.id,
      name: P.name,
      description: "Медовый пряник.",
      price: 1500,
      currency: "KZT",
      country_prices: {},
      is_active: true,
      category_ids: [],
      fulfillment_kind: "digital",
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
    },
  ]);
  // Магазин клиента прежней платформы: согласие и снимок товаров есть, но v2 его не отдаёт.
  const V = F.SH20_V1;
  add(db, "bots", [
    {
      id: V.id,
      bot_name: V.name,
      status: "active",
      vertical: "digital",
      modules: { shop: true, web_storefront: true },
      settings: {
        default_locale: "ru",
        slug: V.slug,
        marketplace: { listed: true, approved: true, category: "Торты", city: "Алматы" },
      },
      paused_message: null,
      owner_telegram_id: null,
      owner_name: null,
      app_url: null,
      archived_at: null,
      bot_token: null,
      subscription_plan: "basic",
      subscription_expires_at: null,
      created_at: now,
    },
  ]);
  add(db, "marketplace_items", [
    {
      bot_id: V.id,
      product_id: V.product.id,
      name: V.product.name,
      search_text: V.product.name.toLowerCase(),
      price: 1200,
      currency: "KZT",
      image: null,
      updated_at: now,
    },
  ]);
}
