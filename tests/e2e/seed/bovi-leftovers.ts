/**
 * Консультант без продаж с модулями магазина из v1 (bovi-leftovers.spec.ts):
 * товаров нет, а рассылки, корзина, возврат, баллы и магазин в Direct включены.
 */
import * as F from "../fixtures.ts";
import type { StubDb } from "../pg-stub.ts";
import { add, encrypt, hash } from "./util.ts";

export function seedBoviLeftovers(db: StubDb, now: string) {
  add(db, "bots", [
    {
      id: F.BOVI_LEFT_ID,
      bot_name: F.BOVI_LEFT_NAME,
      status: "active",
      vertical: "consultant",
      modules: {
        instagram: true,
        shop: true,
        dm_shop: true,
        broadcasts: true,
        cart_reminder: true,
        winback: true,
        loyalty: true,
      },
      settings: {
        served_by: "v2",
        default_locale: "ru",
        consultant_pricelist: { enabled: true },
        admin: { username: F.BOVI_LEFT_LOGIN, password_hash: hash(F.BOVI_LEFT_PASSWORD) },
      },
      paused_message: null,
      owner_telegram_id: 500000241,
      owner_name: "Консультант без продаж",
      app_url: null,
      archived_at: null,
      bot_token: encrypt("700000241:E2E-bovi-left-token", F.SECRETS_KEY),
      subscription_plan: null,
      subscription_expires_at: null,
      created_at: now,
    },
  ]);
  const replied = new Date(Date.parse(now) - 2 * 3_600_000).toISOString();
  add(db, "bot_users", [
    {
      bot_id: F.BOVI_LEFT_ID,
      id: "e2e23000-0000-4000-8000-0000000000b1",
      user_key: F.BOVI_LEFT_BUYER_KEY,
      telegram_id: 9_100_000_241,
      platform: "instagram",
      first_name: F.BOVI_LEFT_BUYER_NAME,
      loyalty_points: 0,
      created_at: now,
      state: { consultant: { last_reply_at: replied, recent: [] } },
    },
  ]);
}
