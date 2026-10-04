/**
 * Страница «Интеграции» (shop14-integrations.spec.ts): магазин «Лавка И14» с модулем
 * CRM, адресом вебхука и журналом из трёх отправок. Основной магазин сида не меняется.
 */
import * as F from "../fixtures.ts";
import type { StubDb } from "../pg-stub.ts";
import { add, encrypt, hash } from "./util.ts";

const int14 = <T extends object>(r: T) => ({ bot_id: F.INT14_SHOP_ID, ...r });

export function seedShop14Integrations(db: StubDb, now: string) {
  add(db, "bots", [
    {
      id: F.INT14_SHOP_ID,
      bot_name: F.INT14_SHOP_NAME,
      status: "active",
      vertical: "digital",
      modules: { shop: true, crm_integration: true },
      settings: {
        served_by: "v2",
        default_locale: "ru",
        slug: F.INT14_SHOP_SLUG,
        telegram: { username: "e2e_int14_bot", webhook_ok: true },
        admin: { username: F.INT14_SELLER_LOGIN, password_hash: hash(F.INT14_SELLER_PASSWORD) },
      },
      paused_message: null,
      owner_telegram_id: 500000014,
      owner_name: "Продавец И14",
      app_url: null,
      archived_at: null,
      bot_token: encrypt("700000014:E2E-int14-token", F.SECRETS_KEY),
      subscription_plan: "business",
      subscription_expires_at: null,
      created_at: now,
    },
  ]);
  const t = Date.parse(now);
  const entry = (
    minAgo: number,
    event: string,
    orderId: number,
    outcome: string,
    status: number | null,
  ) => ({
    at: new Date(t - minAgo * 60_000).toISOString(),
    event,
    orderId,
    eventId: `e2e-ev-${orderId}`,
    outcome,
    status,
  });
  add(db, "zernio_logs", [
    int14({
      id: F.INT14_DEAD_ROW_ID,
      event_id: "outbox:e2e-int14-dead",
      event_type: "outbox.crm_webhook",
      status: "dead",
      error_message: "HTTP 500",
      payload: {
        target: { channel: "webhook", url: F.INT14_HOOK_URL },
        text: JSON.stringify({
          event: "order.payment",
          event_id: "e2e-ev-9101",
          order: { id: 9101 },
        }),
        order_id: null,
        audience: "admin",
        attempts: 1,
        next_at: null,
        last_error: "HTTP 500",
      },
      created_at: now,
    }),
  ]);
  add(db, "app_settings", [
    int14({ key: "shop_name", value: F.INT14_SHOP_NAME, updated_at: now }),
    int14({
      key: "crm_webhook",
      value: JSON.stringify({
        url: F.INT14_HOOK_URL,
        secret: "e2e-secret",
        events: ["placed", "payment"],
      }),
      updated_at: now,
    }),
    int14({
      key: "crm_webhook_log",
      value: JSON.stringify([
        entry(30, "order.placed", 9101, "ok", 200),
        { ...entry(20, "order.payment", 9101, "http", 500), outboxId: F.INT14_DEAD_ROW_ID },
        entry(10, "order.placed", 9102, "timeout", null),
      ]),
      updated_at: now,
    }),
  ]);
}
