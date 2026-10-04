/**
 * Итоги подбора и допродажи (shop16-o-engage.spec.ts): магазин «Кондитерская О16» с модулями
 * quiz и upsell; отметки: квиз прошли трое (двое разных в боте и один с сайта), товар из
 * «С этим берут» добавили двое (один покупатель бота дважды).
 */
import * as F from "../fixtures.ts";
import type { StubDb } from "../pg-stub.ts";
import { add, encrypt, hash } from "./util.ts";

const own = <T extends object>(r: T) => ({ bot_id: F.ENGAGE16_SHOP_ID, ...r });

export function seedShop16OEngage(db: StubDb, now: string) {
  add(db, "bots", [
    {
      id: F.ENGAGE16_SHOP_ID,
      bot_name: F.ENGAGE16_SHOP_NAME,
      status: "active",
      vertical: "digital",
      modules: { shop: true, broadcasts: true, quiz: true, upsell: true },
      settings: {
        served_by: "v2",
        default_locale: "ru",
        slug: "e2e-engage16",
        telegram: { username: "e2e_engage16_bot", webhook_ok: true },
        admin: {
          username: F.ENGAGE16_SELLER_LOGIN,
          password_hash: hash(F.ENGAGE16_SELLER_PASSWORD),
        },
      },
      paused_message: null,
      owner_telegram_id: 500000216,
      owner_name: "Продавец О16",
      app_url: null,
      archived_at: null,
      bot_token: encrypt("700000216:E2E-engage16-token", F.SECRETS_KEY),
      subscription_plan: "business",
      subscription_expires_at: null,
      created_at: now,
    },
  ]);
  add(db, "app_settings", [
    own({ key: "shop_name", value: F.ENGAGE16_SHOP_NAME, updated_at: now }),
  ]);
  const log = (n: number, kind: string, telegramId: number | null) =>
    own({
      id: `e2e00000-0000-4000-8000-0000000016f${n}`,
      event_id: `engage:${F.ENGAGE16_SHOP_ID}:${kind}:${telegramId ?? "web"}:${n}`,
      event_type: "engage",
      status: "done",
      payload: { kind, telegram_id: telegramId },
      error_message: null,
      created_at: now,
    });
  add(db, "zernio_logs", [
    log(1, "quiz_done", 600000216),
    log(2, "quiz_done", 600000217),
    log(3, "quiz_done", null),
    log(4, "upsell_add", 600000216),
    log(5, "upsell_add", 600000216),
  ]);
}
