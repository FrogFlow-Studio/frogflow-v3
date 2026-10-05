/** Поделиться (shop22-r-share.spec.ts): магазин «Поделиться Р22» с ботом и витриной. */
import * as F from "../fixtures.ts";
import type { StubDb } from "../pg-stub.ts";
import { add, encrypt, hash } from "./util.ts";

export function seedShop22RShare(db: StubDb, now: string) {
  add(db, "bots", [
    {
      id: F.SHARE22_SHOP_ID,
      bot_name: F.SHARE22_SHOP_NAME,
      status: "active",
      vertical: "digital",
      modules: { shop: true, dashboard: true, web_storefront: true },
      settings: {
        served_by: "v2",
        default_locale: "ru",
        slug: F.SHARE22_SHOP_SLUG,
        telegram: { username: F.SHARE22_BOT, webhook_ok: true },
        admin: {
          username: F.SHARE22_SELLER_LOGIN,
          password_hash: hash(F.SHARE22_SELLER_PASSWORD),
        },
      },
      paused_message: null,
      owner_telegram_id: 500000255,
      owner_name: "Продавец Поделиться Р22",
      app_url: null,
      archived_at: null,
      bot_token: encrypt("700000255:E2E-share22-token", F.SECRETS_KEY),
      subscription_plan: "basic",
      subscription_expires_at: null,
      created_at: now,
    },
  ]);
  add(db, "app_settings", [
    { bot_id: F.SHARE22_SHOP_ID, key: "shop_name", value: F.SHARE22_SHOP_NAME, updated_at: now },
  ]);
}
