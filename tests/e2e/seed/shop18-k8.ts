/** Итоги розыгрыша (shop18-k8.spec.ts): выбранный розыгрыш, три участника, два оплаченных заказа и один отменённый. */
import * as F from "../fixtures.ts";
import type { StubDb } from "../pg-stub.ts";
import { add, encrypt, hash } from "./util.ts";

const own = <T extends object>(r: T) => ({ bot_id: F.K8_SHOP_ID, ...r });
const ago = (now: string, days: number) =>
  new Date(Date.parse(now) - days * 86_400_000).toISOString();

export function seedShop18K8(db: StubDb, now: string) {
  add(db, "bots", [
    {
      id: F.K8_SHOP_ID,
      bot_name: F.K8_SHOP_NAME,
      status: "active",
      vertical: "digital",
      modules: { shop: true, broadcasts: true, giveaways: true },
      settings: {
        served_by: "v2",
        default_locale: "ru",
        slug: "e2e-k8",
        telegram: { username: "e2e_k8_bot", webhook_ok: true },
        admin: { username: F.K8_SELLER_LOGIN, password_hash: hash(F.K8_SELLER_PASSWORD) },
      },
      paused_message: null,
      owner_telegram_id: 500000318,
      owner_name: "Продавец К8",
      app_url: null,
      archived_at: null,
      bot_token: encrypt("700000318:E2E-k8-token", F.SECRETS_KEY),
      subscription_plan: "business",
      subscription_expires_at: null,
      created_at: now,
    },
  ]);
  const tg = [600000318, 600000319, 600000320];
  add(db, "app_settings", [
    own({ key: "shop_name", value: F.K8_SHOP_NAME, updated_at: now }),
    own({
      key: `giveaway:${F.K8_GIVEAWAY_ID}`,
      updated_at: now,
      value: JSON.stringify({
        id: F.K8_GIVEAWAY_ID,
        rev: 2,
        title: F.K8_GIVEAWAY_TITLE,
        prize: "Набор открыток",
        channel: "telegram",
        conditions: "",
        endsAt: ago(now, 5),
        winners: 1,
        subscribeChannel: "@e2e_k8_channel",
        excludeBlocked: true,
        excludeStaff: true,
        status: "drawn",
        createdAt: ago(now, 12),
        updatedAt: ago(now, 5),
        result: {
          seed: "0123456789abcdef0123456789abcdef",
          listHash: "f".repeat(64),
          entered: 3,
          eligible: 3,
          drawnAt: ago(now, 5),
          winners: [{ userKey: "tg_600000318", telegramId: tg[0], channel: "telegram" }],
          rerolls: [],
        },
      }),
    }),
    own({ key: "giveaway:index", value: JSON.stringify([F.K8_GIVEAWAY_ID]), updated_at: now }),
  ]);
  // Первый участник был в боте и раньше, двое пришли после начала розыгрыша.
  add(
    db,
    "bot_users",
    tg.map((id, i) =>
      own({
        id: `e2e00000-0000-4000-8000-0000000018b${i}`,
        user_key: `tg_${id}`,
        telegram_id: id,
        platform: "telegram",
        first_name: `Участник ${i + 1}`,
        created_at: ago(now, i === 0 ? 90 : 8),
      }),
    ),
  );
  add(
    db,
    "zernio_logs",
    tg.map((id, i) =>
      own({
        event_id: `giveaway:${F.K8_GIVEAWAY_ID}:entry:tg_${id}`,
        event_type: "giveaway.entry",
        status: "event",
        payload: {
          giveaway_id: F.K8_GIVEAWAY_ID,
          user_key: `tg_${id}`,
          telegram_id: id,
          channel: "telegram",
          at: ago(now, 9 - i),
        },
        created_at: ago(now, 9 - i),
      }),
    ),
  );
  const order = (n: number, telegramId: number, status: string, total: number, days: number) =>
    own({
      id: 9000 + n,
      order_no: 9000 + n,
      display_no: 9000 + n,
      status,
      platform: "telegram",
      telegram_id: telegramId,
      user_key: `tg_${telegramId}`,
      display_name: "Участник",
      username: null,
      total,
      paid_amount: 0,
      currency: "KZT",
      fulfillment_kind: "digital",
      created_at: ago(now, days),
      updated_at: ago(now, days),
    });
  add(db, "orders", [
    order(1, tg[0]!, "delivered", 5000, 3),
    order(2, tg[1]!, "delivered", 3000, 2),
    order(3, tg[2]!, "cancelled", 7777, 2),
  ]);
}
