/**
 * Клиент с ИИ-консультантом в Instagram Direct (consultant.spec.ts): без
 * магазина в переписке, консультант включён, продавец получает передачи в
 * Telegram своего бота.
 */
import * as F from "../fixtures.ts";
import type { StubDb } from "../pg-stub.ts";
import { add, encrypt } from "./util.ts";

export function seedConsultant(db: StubDb, now: string) {
  add(db, "bots", [
    {
      id: F.CONS_ID,
      bot_name: F.CONS_NAME,
      status: "active",
      vertical: "digital",
      modules: { instagram: true },
      settings: {
        served_by: "v2",
        default_locale: "ru",
        slug: "e2e-consultant",
        telegram: { username: "e2e_consultant_bot", webhook_ok: true },
        zernio: {
          profile_id: F.CONS_IG_PROFILE,
          account_ids: [F.CONS_IG_ACCOUNT],
          accounts: [{ id: F.CONS_IG_ACCOUNT, platform: "instagram", username: "e2e_towels" }],
        },
      },
      paused_message: null,
      owner_telegram_id: F.CONS_SELLER_TG,
      owner_name: "Продавец консультанта",
      app_url: null,
      archived_at: null,
      bot_token: encrypt(F.CONS_BOT_TOKEN, F.SECRETS_KEY),
      subscription_plan: "pro",
      subscription_expires_at: null,
      created_at: now,
    },
  ]);
  add(
    db,
    "app_settings",
    [
      ["shop_name", F.CONS_NAME],
      ["consultant_enabled", "true"],
    ].map(([key, value]) => ({ bot_id: F.CONS_ID, key, value, updated_at: now })),
  );
}
