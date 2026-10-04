/** Команда магазина (shop19-a-team.spec.ts): магазин «Команда А19» с модулем ролей. */
import * as F from "../fixtures.ts";
import type { StubDb } from "../pg-stub.ts";
import { add, encrypt, hash } from "./util.ts";

const own = <T extends object>(r: T) => ({ bot_id: F.TEAM19_SHOP_ID, ...r });

export function seedShop19ATeam(db: StubDb, now: string) {
  add(db, "bots", [
    {
      id: F.TEAM19_SHOP_ID,
      bot_name: F.TEAM19_SHOP_NAME,
      status: "active",
      vertical: "digital",
      modules: { shop: true, dashboard: true, admin_roles: true },
      settings: {
        served_by: "v2",
        default_locale: "ru",
        slug: F.TEAM19_SHOP_SLUG,
        telegram: { username: "e2e_team19_bot", webhook_ok: true },
        admin: { username: F.TEAM19_SELLER_LOGIN, password_hash: hash(F.TEAM19_SELLER_PASSWORD) },
      },
      paused_message: null,
      owner_telegram_id: 500000170,
      owner_name: "Продавец Команда",
      app_url: null,
      archived_at: null,
      bot_token: encrypt("700000170:E2E-team19-token", F.SECRETS_KEY),
      subscription_plan: "business",
      subscription_expires_at: null,
      created_at: now,
    },
  ]);
  add(db, "app_settings", [own({ key: "shop_name", value: F.TEAM19_SHOP_NAME, updated_at: now })]);
}
