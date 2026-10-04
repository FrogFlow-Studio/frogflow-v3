/** Сборка и печать пачкой (shop19-a-batch.spec.ts): магазин «Сборка А16», заказы к сборке. */
import * as F from "../fixtures.ts";
import type { StubDb } from "../pg-stub.ts";
import { add, encrypt, hash } from "./util.ts";

const own = <T extends object>(r: T) => ({ bot_id: F.BATCH_SHOP_ID, ...r });

export function seedShop19ABatch(db: StubDb, now: string) {
  add(db, "bots", [
    {
      id: F.BATCH_SHOP_ID,
      bot_name: F.BATCH_SHOP_NAME,
      status: "active",
      vertical: "confectionery",
      modules: { shop: true, dashboard: true },
      settings: {
        served_by: "v2",
        default_locale: "ru",
        timezone: "UTC",
        slug: F.BATCH_SHOP_SLUG,
        telegram: { username: "e2e_batch16_bot", webhook_ok: true },
        admin: { username: F.BATCH_SELLER_LOGIN, password_hash: hash(F.BATCH_SELLER_PASSWORD) },
      },
      paused_message: null,
      owner_telegram_id: 500000116,
      owner_name: "Продавец А16",
      app_url: null,
      archived_at: null,
      bot_token: encrypt("700000116:E2E-batch16-token", F.SECRETS_KEY),
      subscription_plan: "business",
      subscription_expires_at: null,
      created_at: now,
    },
  ]);
  add(db, "app_settings", [own({ key: "shop_name", value: F.BATCH_SHOP_NAME, updated_at: now })]);
  const day = (offset: number) =>
    `${new Date(Date.now() + offset * 86400_000).toISOString().slice(0, 10)}T00:00:00Z`;
  F.BATCH_ORDERS.forEach(([id, name, delivery, offset], i) => {
    add(db, "orders", [
      own({
        id,
        order_no: 100 + i,
        display_no: 100 + i,
        status: "accepted",
        // Ручной заказ: чата с покупателем нет, сообщение не отправляется.
        platform: "manual",
        telegram_id: 0,
        user_key: null,
        display_name: name,
        contact: `+7701000${9100 + i}`,
        username: null,
        total: 5000,
        paid_amount: 5000,
        currency: "KZT",
        fulfillment_kind: "physical",
        fulfillment_type: delivery ? "delivery" : "pickup",
        fulfillment_address: delivery ? `ул. Сборочная, ${i + 1}` : null,
        fulfillment_at: day(offset),
        created_at: now,
        updated_at: now,
      }),
    ]);
    add(db, "order_items", [
      own({
        id: `e2e19160-0000-4000-8000-0000000001${i}1`,
        order_id: id,
        product_id: null,
        product_variant_id: null,
        name_snapshot: `Торт сборки ${i + 1}`,
        quantity: 1,
        price_snapshot: 5000,
      }),
    ]);
  });
}
