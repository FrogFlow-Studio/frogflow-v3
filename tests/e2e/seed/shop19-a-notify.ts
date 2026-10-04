/** Центр уведомлений (shop19-a-notify.spec.ts): магазин «Уведомления А19», события заказов и отзыв. */
import * as F from "../fixtures.ts";
import type { StubDb } from "../pg-stub.ts";
import { add, encrypt, hash } from "./util.ts";

const own = <T extends object>(r: T) => ({ bot_id: F.NTF19_SHOP_ID, ...r });

export function seedShop19ANotify(db: StubDb, now: string) {
  add(db, "bots", [
    {
      id: F.NTF19_SHOP_ID,
      bot_name: F.NTF19_SHOP_NAME,
      status: "active",
      vertical: "digital",
      modules: { shop: true, dashboard: true, admin_roles: true, review_request: true },
      settings: {
        served_by: "v2",
        default_locale: "ru",
        slug: F.NTF19_SHOP_SLUG,
        telegram: { username: "e2e_ntf19_bot", webhook_ok: true },
        admin: {
          username: F.NTF19_SELLER_LOGIN,
          password_hash: hash(F.NTF19_SELLER_PASSWORD),
          users: [
            {
              username: F.NTF19_ACC_LOGIN,
              password_hash: hash(F.NTF19_ACC_PASSWORD),
              role: "accountant",
            },
          ],
        },
      },
      paused_message: null,
      owner_telegram_id: 500000040,
      owner_name: "Продавец А19",
      app_url: null,
      archived_at: null,
      bot_token: encrypt("700000040:E2E-ntf19-token", F.SECRETS_KEY),
      subscription_plan: "business",
      subscription_expires_at: null,
      created_at: now,
    },
  ]);
  add(db, "app_settings", [own({ key: "shop_name", value: F.NTF19_SHOP_NAME, updated_at: now })]);
  for (const [id, no, name] of [
    [98951, 1, F.NTF19_BUYER],
    [98952, 2, "Ева П"],
  ] as const)
    add(db, "orders", [
      own({
        id,
        order_no: no,
        display_no: no,
        status: "accepted",
        platform: "telegram",
        telegram_id: 620000000 + no,
        user_key: `tg_${620000000 + no}`,
        display_name: name,
        contact: "+77010000000",
        username: null,
        total: 4000 * no,
        paid_amount: 0,
        currency: "KZT",
        fulfillment_kind: "digital",
        created_at: now,
        updated_at: now,
      }),
    ]);
  const ev = (n: number, bot: string, type: string, order: number, extra = {}) => ({
    id: `e2e19040-0000-4000-8000-0000000001a${n}`,
    bot_id: bot,
    event_id: `order:${order}:${type}:${n}`,
    event_type: type,
    status: "event",
    payload: { order_id: order, actor: "bot", ...extra },
    error_message: null,
    created_at: now,
  });
  add(db, "zernio_logs", [
    ev(1, F.NTF19_SHOP_ID, "order.placed", 98951),
    ev(2, F.NTF19_SHOP_ID, "order.proof", 98952),
    ev(3, F.NTF19_SHOP_ID, "order.refund", 98951, { amount: 1000, currency: "KZT" }),
    // Событие другого магазина: в этой ленте его нет.
    ev(4, F.ORD19_SHOP_ID, "order.placed", 98901),
  ]);
  add(db, "product_reviews", [
    own({
      id: "e2e19040-0000-4000-8000-0000000001b1",
      product_id: "e2e19040-0000-4000-8000-0000000001c1",
      telegram_id: 620000001,
      rating: 5,
      comment: "Отличный отзыв А19",
      created_at: now,
      updated_at: now,
    }),
  ]);
}
