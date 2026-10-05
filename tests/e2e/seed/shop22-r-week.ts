/** «Первые 7 дней» (shop22-r-week.spec.ts): два пустых магазина «Неделя Р22». */
import * as F from "../fixtures.ts";
import type { StubDb } from "../pg-stub.ts";
import { add, encrypt, hash } from "./util.ts";

export function seedShop22RWeek(db: StubDb, now: string) {
  for (const s of F.WEEK22_SHOPS) {
    add(db, "bots", [
      {
        id: s.id,
        bot_name: s.name,
        status: "active",
        vertical: "digital",
        modules: { shop: true, dashboard: true },
        settings: {
          served_by: "v2",
          default_locale: "ru",
          slug: s.slug,
          telegram: { username: `${s.slug.replace(/-/g, "_")}_bot`, webhook_ok: true },
          admin: { username: s.login, password_hash: hash(s.password) },
        },
        paused_message: null,
        owner_telegram_id: s.tg,
        owner_name: `Продавец ${s.name}`,
        app_url: null,
        archived_at: null,
        bot_token: encrypt(`7000002${s.tg % 1000}:E2E-week22-token`, F.SECRETS_KEY),
        subscription_plan: "basic",
        subscription_expires_at: null,
        created_at: now,
      },
    ]);
    add(db, "app_settings", [{ bot_id: s.id, key: "shop_name", value: s.name, updated_at: now }]);
  }
}
