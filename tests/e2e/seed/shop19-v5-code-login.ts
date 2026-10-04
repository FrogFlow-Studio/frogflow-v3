/**
 * Вход по коду (shop19-v5-code-login.spec.ts): отдельный магазин «Лавка В5» — оформление
 * с сайта и вход покупателей включены, у бота есть токен и имя. Без товаров и заказов.
 */
import * as F from "../fixtures.ts";
import type { StubDb } from "../pg-stub.ts";
import { add, encrypt } from "./util.ts";

export function seedShop19V5CodeLogin(db: StubDb, now: string) {
  add(db, "bots", [
    {
      id: F.CODELOGIN_SHOP_ID,
      bot_name: F.CODELOGIN_SHOP_NAME,
      status: "active",
      vertical: "digital",
      modules: { shop: true, web_storefront: true },
      settings: {
        served_by: "v2",
        default_locale: "ru",
        slug: F.CODELOGIN_SHOP_SLUG,
        telegram: { username: F.CODELOGIN_BOT, webhook_ok: true },
      },
      paused_message: null,
      owner_telegram_id: 500000019,
      owner_name: "Продавец В5",
      app_url: null,
      archived_at: null,
      bot_token: encrypt("700000019:E2E-codelogin-token", F.SECRETS_KEY),
      subscription_plan: "basic",
      subscription_expires_at: null,
      created_at: now,
    },
  ]);
  add(db, "app_settings", [
    {
      bot_id: F.CODELOGIN_SHOP_ID,
      key: "shop_name",
      value: F.CODELOGIN_SHOP_NAME,
      updated_at: now,
    },
    {
      bot_id: F.CODELOGIN_SHOP_ID,
      key: "storefront_checkout",
      value: '{"enabled":true,"tgLogin":true}',
      updated_at: now,
    },
  ]);
}
