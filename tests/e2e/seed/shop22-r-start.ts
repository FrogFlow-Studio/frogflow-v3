/** Первая продажа (shop22-r-*.spec.ts): пустой магазин «Старт Р22» без товаров. */
import * as F from "../fixtures.ts";
import type { StubDb } from "../pg-stub.ts";
import { add, encrypt, hash } from "./util.ts";

export function seedShop22RStart(db: StubDb, now: string) {
  add(db, "bots", [
    {
      id: F.START22_SHOP_ID,
      bot_name: F.START22_SHOP_NAME,
      status: "active",
      vertical: "digital",
      modules: { shop: true, dashboard: true },
      settings: {
        served_by: "v2",
        default_locale: "ru",
        slug: F.START22_SHOP_SLUG,
        telegram: { username: "e2e_start22_bot", webhook_ok: true },
        admin: {
          username: F.START22_SELLER_LOGIN,
          password_hash: hash(F.START22_SELLER_PASSWORD),
        },
      },
      paused_message: null,
      owner_telegram_id: 500000221,
      owner_name: "Продавец Старт Р22",
      app_url: null,
      archived_at: null,
      bot_token: encrypt("700000221:E2E-start22-token", F.SECRETS_KEY),
      subscription_plan: "basic",
      subscription_expires_at: null,
      created_at: now,
    },
  ]);
  add(db, "app_settings", [
    { bot_id: F.START22_SHOP_ID, key: "shop_name", value: F.START22_SHOP_NAME, updated_at: now },
  ]);
}
