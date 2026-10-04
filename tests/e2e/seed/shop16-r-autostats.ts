/**
 * Итоги автосообщений (shop16-r-autostats.spec.ts): магазин «Кондитерская Р16»,
 * три напоминания о корзине (одно не дошло), одно сообщение возврата клиентов и
 * оплаченный заказ 4 500 после первого напоминания.
 */
import * as F from "../fixtures.ts";
import type { StubDb } from "../pg-stub.ts";
import { add, encrypt, hash } from "./util.ts";

const own = <T extends object>(r: T) => ({ bot_id: F.AUTO16_SHOP_ID, ...r });

export function seedShop16RAutostats(db: StubDb, now: string) {
  add(db, "bots", [
    {
      id: F.AUTO16_SHOP_ID,
      bot_name: F.AUTO16_SHOP_NAME,
      status: "active",
      vertical: "digital",
      modules: { shop: true, broadcasts: true, cart_reminder: true, winback: true },
      settings: {
        served_by: "v2",
        default_locale: "ru",
        slug: "e2e-auto16",
        telegram: { username: "e2e_auto16_bot", webhook_ok: true },
        admin: { username: F.AUTO16_SELLER_LOGIN, password_hash: hash(F.AUTO16_SELLER_PASSWORD) },
      },
      paused_message: null,
      owner_telegram_id: 500000116,
      owner_name: "Продавец Р16",
      app_url: null,
      archived_at: null,
      bot_token: encrypt("700000116:E2E-auto16-token", F.SECRETS_KEY),
      subscription_plan: "business",
      subscription_expires_at: null,
      created_at: now,
    },
  ]);
  add(db, "app_settings", [own({ key: "shop_name", value: F.AUTO16_SHOP_NAME, updated_at: now })]);
  const log = (n: number, kind: string, telegramId: number, status: string) =>
    own({
      id: `e2e00000-0000-4000-8000-0000000016b${n}`,
      event_id: `automsg:${F.AUTO16_SHOP_ID}:${kind}:${telegramId}:${n}`,
      event_type: "automsg",
      status,
      payload: { kind, telegram_id: telegramId },
      error_message: null,
      created_at: now,
    });
  add(db, "zernio_logs", [
    log(1, "cart", 600000116, "sent"),
    log(2, "cart", 600000117, "sent"),
    log(3, "cart", 600000118, "failed"),
    log(4, "winback", 600000119, "sent"),
  ]);
  add(db, "orders", [
    own({
      id: F.AUTO16_ORDER_ID,
      order_no: 1,
      display_no: 1,
      status: "delivered",
      platform: "telegram",
      telegram_id: 600000116,
      user_key: "tg_600000116",
      display_name: "Анна",
      username: null,
      total: 4500,
      paid_amount: 4500,
      currency: "KZT",
      fulfillment_kind: "physical",
      // после отметки отправки (та же секунда сида + час), в пределах 7 дней
      created_at: new Date(Date.parse(now) + 3600_000).toISOString(),
      updated_at: now,
    }),
  ]);
}
