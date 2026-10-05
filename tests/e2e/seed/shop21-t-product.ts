/** Товар (shop21-t-product.spec.ts): магазин «Товар Т21». */
import * as F from "../fixtures.ts";
import type { StubDb } from "../pg-stub.ts";
import { add, encrypt, hash } from "./util.ts";

const own = <T extends object>(r: T) => ({ bot_id: F.PRODUCT21_SHOP_ID, ...r });

export function seedShop21TProduct(db: StubDb, now: string) {
  add(db, "bots", [
    {
      id: F.PRODUCT21_SHOP_ID,
      bot_name: F.PRODUCT21_SHOP_NAME,
      status: "active",
      vertical: "digital",
      modules: {
        shop: true,
        dashboard: true,
        stock: true,
        warehouse: true,
        bundles: true,
      },
      settings: {
        served_by: "v2",
        default_locale: "ru",
        slug: F.PRODUCT21_SHOP_SLUG,
        telegram: { username: "e2e_product21_bot", webhook_ok: true },
        admin: {
          username: F.PRODUCT21_SELLER_LOGIN,
          password_hash: hash(F.PRODUCT21_SELLER_PASSWORD),
        },
      },
      paused_message: null,
      owner_telegram_id: 500000121,
      owner_name: "Продавец Товар Т21",
      app_url: null,
      archived_at: null,
      bot_token: encrypt("700000121:E2E-product21-token", F.SECRETS_KEY),
      subscription_plan: "business",
      subscription_expires_at: null,
      created_at: now,
    },
  ]);
  add(db, "app_settings", [
    own({ key: "shop_name", value: F.PRODUCT21_SHOP_NAME, updated_at: now }),
  ]);
}
