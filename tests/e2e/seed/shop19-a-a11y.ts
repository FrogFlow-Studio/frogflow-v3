/** Доступность (shop19-a-a11y.spec.ts): магазин «Доступность А19». */
import * as F from "../fixtures.ts";
import type { StubDb } from "../pg-stub.ts";
import { add, encrypt, hash } from "./util.ts";

const own = <T extends object>(r: T) => ({ bot_id: F.A11Y19_SHOP_ID, ...r });

export function seedShop19AA11y(db: StubDb, now: string) {
  add(db, "bots", [
    {
      id: F.A11Y19_SHOP_ID,
      bot_name: F.A11Y19_SHOP_NAME,
      status: "active",
      vertical: "digital",
      modules: {
        shop: true,
        dashboard: true,
        stock: true,
        warehouse: true,
        giveaways: true,
        bundles: true,
        broadcasts: true,
      },
      settings: {
        served_by: "v2",
        default_locale: "ru",
        slug: F.A11Y19_SHOP_SLUG,
        telegram: { username: "e2e_a11y19_bot", webhook_ok: true },
        admin: { username: F.A11Y19_SELLER_LOGIN, password_hash: hash(F.A11Y19_SELLER_PASSWORD) },
      },
      paused_message: null,
      owner_telegram_id: 500000021,
      owner_name: "Продавец Доступность",
      app_url: null,
      archived_at: null,
      bot_token: encrypt("700000021:E2E-a11y19-token", F.SECRETS_KEY),
      subscription_plan: "business",
      subscription_expires_at: null,
      created_at: now,
    },
  ]);
  add(db, "app_settings", [own({ key: "shop_name", value: F.A11Y19_SHOP_NAME, updated_at: now })]);
}
