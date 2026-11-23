/** Блокировка покупателя из Instagram (customers-block.spec.ts): модуль blocked, два покупателя. */
import * as F from "../fixtures.ts";
import type { StubDb } from "../pg-stub.ts";
import { add, encrypt, hash } from "./util.ts";

export function seedCustomersBlock(db: StubDb, now: string) {
  add(db, "bots", [
    {
      id: F.CB_SHOP_ID,
      bot_name: F.CB_SHOP_NAME,
      status: "active",
      vertical: "digital",
      modules: { shop: true, blocked: true, instagram: true },
      settings: {
        served_by: "v2",
        default_locale: "ru",
        slug: "e2e-cb",
        telegram: { username: "e2e_cb_bot", webhook_ok: true },
        admin: { username: F.CB_SELLER_LOGIN, password_hash: hash(F.CB_SELLER_PASSWORD) },
      },
      paused_message: null,
      owner_telegram_id: 500000910,
      owner_name: "Продавец ЧС",
      app_url: null,
      archived_at: null,
      bot_token: encrypt("700000910:E2E-cb-token", F.SECRETS_KEY),
      subscription_plan: "business",
      subscription_expires_at: null,
      created_at: now,
    },
  ]);
  add(db, "app_settings", [
    { bot_id: F.CB_SHOP_ID, key: "shop_name", value: F.CB_SHOP_NAME, updated_at: now },
  ]);
  add(db, "bot_users", [
    {
      bot_id: F.CB_SHOP_ID,
      id: "e2e00000-0000-4000-8000-0000000b1011",
      user_key: "ig_e2e_cb_1",
      platform: "instagram",
      telegram_id: -910001,
      username: F.CB_IG_USERNAME,
      first_name: F.CB_IG_NAME,
      loyalty_points: 8,
      created_at: now,
    },
    {
      bot_id: F.CB_SHOP_ID,
      id: "e2e00000-0000-4000-8000-0000000b1012",
      user_key: "tg_600000910",
      platform: "telegram",
      telegram_id: 600000910,
      first_name: F.CB_TG_NAME,
      created_at: now,
    },
  ]);
}
