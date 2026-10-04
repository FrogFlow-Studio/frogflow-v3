/** Обход новых страниц админки (shop20-r-walk.spec.ts): магазин «Обход Р20», владелец, бухгалтер, заказы к сборке. */
import * as F from "../fixtures.ts";
import type { StubDb } from "../pg-stub.ts";
import { add, encrypt, hash } from "./util.ts";

const own = <T extends object>(r: T) => ({ bot_id: F.R20_SHOP_ID, ...r });

export function seedShop20RWalk(db: StubDb, now: string) {
  add(db, "bots", [
    {
      id: F.R20_SHOP_ID,
      bot_name: F.R20_SHOP_NAME,
      status: "active",
      vertical: "confectionery",
      modules: { shop: true, dashboard: true, admin_roles: true },
      settings: {
        served_by: "v2",
        default_locale: "ru",
        timezone: "UTC",
        slug: F.R20_SHOP_SLUG,
        telegram: { username: "e2e_r20_bot", webhook_ok: true },
        admin: {
          username: F.R20_SELLER_LOGIN,
          password_hash: hash(F.R20_SELLER_PASSWORD),
          users: [
            {
              username: F.R20_ACC_LOGIN,
              password_hash: hash(F.R20_ACC_PASSWORD),
              role: "accountant",
            },
          ],
        },
      },
      paused_message: null,
      owner_telegram_id: 500000200,
      owner_name: "Продавец Р20",
      app_url: null,
      archived_at: null,
      bot_token: encrypt("700000200:E2E-r20-token", F.SECRETS_KEY),
      subscription_plan: "business",
      subscription_expires_at: null,
      created_at: now,
    },
  ]);
  add(db, "app_settings", [own({ key: "shop_name", value: F.R20_SHOP_NAME, updated_at: now })]);
  const today = `${new Date().toISOString().slice(0, 10)}T00:00:00Z`;
  F.R20_ORDERS.forEach(([id, name], i) => {
    add(db, "orders", [
      own({
        id,
        order_no: 200 + i,
        display_no: 200 + i,
        status: "accepted",
        // Ручной заказ: чата с покупателем нет, сообщение не отправляется.
        platform: "manual",
        telegram_id: 0,
        user_key: null,
        display_name: name,
        contact: `+7701000${9200 + i}`,
        username: null,
        total: 5000,
        paid_amount: 5000,
        currency: "KZT",
        fulfillment_kind: "physical",
        fulfillment_type: "pickup",
        fulfillment_address: null,
        fulfillment_at: today,
        created_at: now,
        updated_at: now,
      }),
    ]);
    add(db, "order_items", [
      own({
        id: `e2e20100-0000-4000-8000-0000000001${i}1`,
        order_id: id,
        product_id: null,
        product_variant_id: null,
        name_snapshot: `Торт обхода ${i + 1}`,
        quantity: 1,
        price_snapshot: 5000,
      }),
    ]);
  });
}
