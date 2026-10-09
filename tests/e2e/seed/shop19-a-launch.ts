/** «Запуск магазина» на главной (shop19-a-launch.spec.ts): магазин «Запуск А11» с одной оплаченной продажей. */
import * as F from "../fixtures.ts";
import type { StubDb } from "../pg-stub.ts";
import { add, encrypt, hash } from "./util.ts";

const own = <T extends object>(r: T) => ({ bot_id: F.LAUNCH19_SHOP_ID, ...r });

export function seedShop19ALaunch(db: StubDb, now: string) {
  add(db, "bots", [
    {
      id: F.LAUNCH19_SHOP_ID,
      bot_name: F.LAUNCH19_SHOP_NAME,
      status: "active",
      vertical: "confectionery",
      modules: { shop: true, dashboard: true },
      settings: {
        served_by: "v2",
        default_locale: "ru",
        timezone: "UTC",
        slug: F.LAUNCH19_SHOP_SLUG,
        telegram: { username: "e2e_launch19_bot", webhook_ok: true },
        admin: {
          username: F.LAUNCH19_SELLER_LOGIN,
          password_hash: hash(F.LAUNCH19_SELLER_PASSWORD),
        },
      },
      paused_message: null,
      owner_telegram_id: 500000191,
      owner_name: "Продавец А11",
      app_url: null,
      archived_at: null,
      bot_token: encrypt("700000191:E2E-launch19-token", F.SECRETS_KEY),
      subscription_plan: "business",
      subscription_expires_at: null,
      created_at: now,
    },
  ]);
  add(db, "app_settings", [
    own({ key: "shop_name", value: F.LAUNCH19_SHOP_NAME, updated_at: now }),
  ]);
  add(db, "orders", [
    own({
      id: F.LAUNCH19_ORDER_ID,
      order_no: 191,
      display_no: 191,
      status: "accepted",
      // Ручной заказ: чата с покупателем нет, сообщение не отправляется.
      platform: "manual",
      telegram_id: 0,
      user_key: null,
      display_name: "Покупатель А11",
      contact: "+77010009191",
      username: null,
      total: 5000,
      paid_amount: 5000,
      currency: "KZT",
      fulfillment_kind: "physical",
      fulfillment_type: "pickup",
      fulfillment_address: null,
      fulfillment_at: now,
      created_at: now,
      updated_at: now,
    }),
  ]);
  add(db, "order_items", [
    own({
      id: "e2e19a10-0000-4000-8000-000000000011",
      order_id: F.LAUNCH19_ORDER_ID,
      product_id: null,
      product_variant_id: null,
      name_snapshot: "Торт А11",
      quantity: 1,
      price_snapshot: 5000,
    }),
  ]);
}
