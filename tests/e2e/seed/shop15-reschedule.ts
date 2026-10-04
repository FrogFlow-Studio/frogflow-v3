/**
 * Перенос даты заказа (shop15-reschedule.spec.ts): отдельный магазин «Пекарня В15»,
 * воскресенье без выдачи, лимит один заказ на день.
 */
import * as F from "../fixtures.ts";
import type { StubDb } from "../pg-stub.ts";
import { add, encrypt, hash } from "./util.ts";

const own = <T extends object>(r: T) => ({ bot_id: F.RESCHED15_SHOP_ID, ...r });

export function seedShop15Reschedule(db: StubDb, now: string) {
  add(db, "bots", [
    {
      id: F.RESCHED15_SHOP_ID,
      bot_name: F.RESCHED15_SHOP_NAME,
      status: "active",
      vertical: "digital",
      modules: { shop: true },
      settings: {
        served_by: "v2",
        default_locale: "ru",
        slug: "e2e-resched15",
        admin: {
          username: F.RESCHED15_SELLER_LOGIN,
          password_hash: hash(F.RESCHED15_SELLER_PASSWORD),
        },
        telegram: { username: "e2e_resched15_bot", webhook_ok: true },
      },
      paused_message: null,
      owner_telegram_id: 500000116,
      owner_name: "Продавец В15",
      app_url: null,
      archived_at: null,
      bot_token: encrypt("700000116:E2E-resched15-token", F.SECRETS_KEY),
      subscription_plan: "basic",
      subscription_expires_at: null,
      created_at: now,
    },
  ]);
  add(db, "app_settings", [
    own({ key: "shop_name", value: F.RESCHED15_SHOP_NAME, updated_at: now }),
    own({ key: "fulfillment_closed_weekdays", value: "7", updated_at: now }),
    own({ key: "fulfillment_day_limit", value: "1", updated_at: now }),
  ]);
  const order = (id: number, no: number, day: string) =>
    own({
      id,
      order_no: no,
      display_no: null,
      status: "accepted",
      platform: "telegram",
      telegram_id: 150150 + no,
      user_key: `tg_${150150 + no}`,
      display_name: "Покупатель В15",
      username: null,
      total: 8000,
      paid_amount: 0,
      currency: "KZT",
      fulfillment_kind: "physical",
      fulfillment_type: "pickup",
      fulfillment_at: `${day}T00:00:00Z`,
      created_at: now,
      updated_at: now,
    });
  add(db, "orders", [
    order(F.RESCHED15_ORDER_ID, 1, F.reschedOrderDay()),
    order(F.RESCHED15_BUSY_ORDER_ID, 2, F.reschedBusyDay()),
  ]);
}
