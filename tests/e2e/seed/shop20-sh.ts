/**
 * «Лавка Ш» (shop20-sh-report.spec.ts): магазин на v2, согласный и одобренный на площадке, с
 * одним товаром. В таблицу каталога `marketplace_shops` не добавлена, чтобы не менять
 * счёт магазинов в спецификациях каталога.
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
      vertical: "confectionery",
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
      fulfillment_kind: "physical",
      stock_quantity: 5,
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
}
