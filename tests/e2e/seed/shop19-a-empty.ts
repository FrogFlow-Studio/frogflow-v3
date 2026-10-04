/** Пустые состояния (shop19-a-empty.spec.ts): магазин «Пусто А19» без данных. */
import * as F from "../fixtures.ts";
import type { StubDb } from "../pg-stub.ts";
import { add, encrypt, hash } from "./util.ts";

const own = <T extends object>(r: T) => ({ bot_id: F.EMPTY19_SHOP_ID, ...r });

export function seedShop19AEmpty(db: StubDb, now: string) {
  add(db, "bots", [
    {
      id: F.EMPTY19_SHOP_ID,
      bot_name: F.EMPTY19_SHOP_NAME,
      status: "active",
      vertical: "digital",
      modules: { shop: true, dashboard: true },
      settings: {
        served_by: "v2",
        default_locale: "ru",
        slug: F.EMPTY19_SHOP_SLUG,
        telegram: { username: "e2e_empty19_bot", webhook_ok: true },
        admin: { username: F.EMPTY19_SELLER_LOGIN, password_hash: hash(F.EMPTY19_SELLER_PASSWORD) },
      },
      paused_message: null,
      owner_telegram_id: 500000020,
      owner_name: "Продавец Пусто",
      app_url: null,
      archived_at: null,
      bot_token: encrypt("700000020:E2E-empty19-token", F.SECRETS_KEY),
      subscription_plan: "business",
      subscription_expires_at: null,
      created_at: now,
    },
  ]);
  add(db, "app_settings", [own({ key: "shop_name", value: F.EMPTY19_SHOP_NAME, updated_at: now })]);
}
