/** Центр отчётов (shop19-a-reports.spec.ts): магазин «Отчёты А19», заказы разных статусов. */
import * as F from "../fixtures.ts";
import type { StubDb } from "../pg-stub.ts";
import { add, encrypt, hash } from "./util.ts";

const own = <T extends object>(r: T) => ({ bot_id: F.RPT19_SHOP_ID, ...r });

export function seedShop19AReports(db: StubDb, now: string) {
  add(db, "bots", [
    {
      id: F.RPT19_SHOP_ID,
      bot_name: F.RPT19_SHOP_NAME,
      status: "active",
      vertical: "digital",
      modules: { shop: true, dashboard: true, admin_roles: true },
      settings: {
        served_by: "v2",
        default_locale: "ru",
        slug: F.RPT19_SHOP_SLUG,
        telegram: { username: "e2e_rpt19_bot", webhook_ok: true },
        admin: {
          username: F.RPT19_SELLER_LOGIN,
          password_hash: hash(F.RPT19_SELLER_PASSWORD),
          users: [
            {
              username: F.RPT19_ACC_LOGIN,
              password_hash: hash(F.RPT19_ACC_PASSWORD),
              role: "accountant",
            },
          ],
        },
      },
      paused_message: null,
      owner_telegram_id: 500000070,
      owner_name: "Продавец А19",
      app_url: null,
      archived_at: null,
      bot_token: encrypt("700000070:E2E-rpt19-token", F.SECRETS_KEY),
      subscription_plan: "business",
      subscription_expires_at: null,
      created_at: now,
    },
  ]);
  add(db, "app_settings", [own({ key: "shop_name", value: F.RPT19_SHOP_NAME, updated_at: now })]);
  for (const [id, no, status, total, paid] of [
    [98971, 1, "delivered", 5000, 5000],
    [98972, 2, "awaiting_payment", 9000, 0],
    [98973, 3, "rejected", 700, 0],
  ] as const)
    add(db, "orders", [
      own({
        id,
        order_no: no,
        display_no: no,
        status,
        platform: "telegram",
        telegram_id: 630000000 + no,
        user_key: `tg_${630000000 + no}`,
        display_name: `Покупатель ${no}`,
        contact: "+77010000000",
        username: null,
        total,
        paid_amount: paid,
        currency: "KZT",
        fulfillment_kind: "digital",
        points_earned: 0,
        points_used: 0,
        created_at: now,
        updated_at: now,
      }),
    ]);
}
