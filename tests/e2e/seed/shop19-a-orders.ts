/** Заказы на телефоне (shop19-a-orders.spec.ts): магазин «Заказы А19», три заказа. */
import * as F from "../fixtures.ts";
import type { StubDb } from "../pg-stub.ts";
import { add, encrypt, hash } from "./util.ts";

const own = <T extends object>(r: T) => ({ bot_id: F.ORD19_SHOP_ID, ...r });

export function seedShop19AOrders(db: StubDb, now: string) {
  add(db, "bots", [
    {
      id: F.ORD19_SHOP_ID,
      bot_name: F.ORD19_SHOP_NAME,
      status: "active",
      vertical: "digital",
      modules: { shop: true, dashboard: true },
      settings: {
        served_by: "v2",
        default_locale: "ru",
        slug: F.ORD19_SHOP_SLUG,
        telegram: { username: "e2e_ord19_bot", webhook_ok: true },
        admin: { username: F.ORD19_SELLER_LOGIN, password_hash: hash(F.ORD19_SELLER_PASSWORD) },
      },
      paused_message: null,
      owner_telegram_id: 500000019,
      owner_name: "Продавец А19",
      app_url: null,
      archived_at: null,
      bot_token: encrypt("700000019:E2E-ord19-token", F.SECRETS_KEY),
      subscription_plan: "business",
      subscription_expires_at: null,
      created_at: now,
    },
  ]);
  add(db, "app_settings", [own({ key: "shop_name", value: F.ORD19_SHOP_NAME, updated_at: now })]);
  F.ORD19_ORDERS.forEach(([id, status, name, phone, product], i) => {
    add(db, "orders", [
      own({
        id,
        order_no: i + 1,
        display_no: i + 1,
        status,
        platform: "telegram",
        telegram_id: 610000000 + i,
        user_key: `tg_${610000000 + i}`,
        display_name: name,
        contact: phone,
        username: null,
        total: 3000 + i * 1000,
        paid_amount: 0,
        currency: "KZT",
        fulfillment_kind: "digital",
        created_at: now,
        updated_at: now,
      }),
    ]);
    add(db, "order_items", [
      own({
        id: `e2e19030-0000-4000-8000-0000000001${i}1`,
        order_id: id,
        product_id: null,
        product_variant_id: null,
        name_snapshot: product,
        quantity: 1,
        price_snapshot: 3000 + i * 1000,
      }),
    ]);
  });
}
