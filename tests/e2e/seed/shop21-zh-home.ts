/** Главная в новом виде (shop21-zh-home.spec.ts): магазин «Главная Ж21», три роли, заказы. */
import * as F from "../fixtures.ts";
import type { StubDb } from "../pg-stub.ts";
import { add, encrypt, hash } from "./util.ts";

const own = <T extends object>(r: T) => ({ bot_id: F.ZH21_SHOP_ID, ...r });

export function seedShop21ZhHome(db: StubDb, now: string) {
  add(db, "bots", [
    {
      id: F.ZH21_SHOP_ID,
      bot_name: F.ZH21_SHOP_NAME,
      status: "active",
      vertical: "confectionery",
      modules: {
        shop: true,
        dashboard: true,
        admin_roles: true,
        manager_chat: true,
        broadcasts: true,
        coupons: true,
      },
      settings: {
        served_by: "v2",
        default_locale: "ru",
        timezone: "UTC",
        slug: F.ZH21_SHOP_SLUG,
        telegram: { username: "e2e_zh21_bot", webhook_ok: true },
        admin: {
          username: F.ZH21_SELLER_LOGIN,
          password_hash: hash(F.ZH21_SELLER_PASSWORD),
          users: [
            {
              username: F.ZH21_MANAGER_LOGIN,
              password_hash: hash(F.ZH21_MANAGER_PASSWORD),
              role: "manager",
            },
            {
              username: F.ZH21_ACC_LOGIN,
              password_hash: hash(F.ZH21_ACC_PASSWORD),
              role: "accountant",
            },
          ],
        },
      },
      paused_message: null,
      owner_telegram_id: 500000210,
      owner_name: "Продавец Ж21",
      app_url: null,
      archived_at: null,
      bot_token: encrypt("700000210:E2E-zh21-token", F.SECRETS_KEY),
      subscription_plan: "business",
      subscription_expires_at: null,
      created_at: now,
    },
  ]);
  add(db, "app_settings", [own({ key: "shop_name", value: F.ZH21_SHOP_NAME, updated_at: now })]);
  for (const [id, no, status, name] of [
    [99201, 1, "awaiting_confirmation", "Чек Анна"],
    [99202, 2, "delivered", "Выдан Борис"],
  ] as const)
    add(db, "orders", [
      own({
        id,
        order_no: no,
        display_no: no,
        status,
        platform: "manual",
        telegram_id: 0,
        user_key: null,
        display_name: name,
        contact: `+7701000${9300 + no}`,
        username: null,
        total: 5000,
        paid_amount: 5000,
        currency: "KZT",
        fulfillment_kind: "digital",
        created_at: now,
        updated_at: now,
      }),
    ]);
}
