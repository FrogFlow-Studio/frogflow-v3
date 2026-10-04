/**
 * Мастер подключения канала (shop19-p5-wizard.spec.ts): магазин «Лавка П5» с
 * Instagram; вход в аккаунт пройден, вебхук платформы ещё не привязан —
 * мастер стоит на шаге «проверка связи» с причиной.
 */
import * as F from "../fixtures.ts";
import type { StubDb } from "../pg-stub.ts";
import { add, encrypt, hash } from "./util.ts";

export function seedShop19P5Wizard(db: StubDb, now: string) {
  add(db, "bots", [
    {
      id: F.P5_SHOP_ID,
      bot_name: F.P5_SHOP_NAME,
      status: "active",
      vertical: "digital",
      modules: { shop: true, instagram: true },
      settings: {
        served_by: "v2",
        default_locale: "ru",
        slug: F.P5_SHOP_SLUG,
        telegram: { username: "e2e_p5_bot", webhook_ok: true },
        admin: { username: F.P5_SELLER_LOGIN, password_hash: hash(F.P5_SELLER_PASSWORD) },
        zernio: {
          profile_id: "e2e-zernio-profile-p5",
          account_ids: ["e2e-ig-p5"],
          accounts: [{ id: "e2e-ig-p5", platform: "instagram", username: "e2e_p5" }],
          wizard: {
            instagram: {
              step: "webhook",
              problem: "webhook_off",
              at: now,
              started_at: now,
            },
          },
        },
      },
      paused_message: null,
      owner_telegram_id: 500000015,
      owner_name: "Продавец П5",
      app_url: null,
      archived_at: null,
      bot_token: encrypt("700000015:E2E-p5-token", F.SECRETS_KEY),
      subscription_plan: "business",
      subscription_expires_at: null,
      created_at: now,
    },
  ]);
}
