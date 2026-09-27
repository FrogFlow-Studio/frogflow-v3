/**
 * VIP-клиент (DID 02, Развивашка): отдельный магазин на v2 с VIP-ботом,
 * группой и двумя тарифами — «первый вход» и продление (vip.spec.ts).
 */
import * as F from "../fixtures.ts";
import type { StubDb } from "../pg-stub.ts";
import { add, encrypt } from "./util.ts";

const vip = <T extends object>(r: T) => ({ bot_id: F.VIP_SHOP_ID, ...r });

export function seedVip(db: StubDb, now: string) {
  add(db, "bots", [
    {
      id: F.VIP_SHOP_ID,
      bot_name: "VIP E2E",
      status: "active",
      vertical: "digital",
      modules: { vip: true },
      settings: {
        served_by: "v2",
        default_locale: "ru",
        slug: "e2e-vip",
        telegram: { username: "e2e_vip_shop_bot", webhook_ok: true },
        vip: {
          token_enc: encrypt(F.VIP_TOKEN, F.SECRETS_KEY),
          username: "e2e_vip_bot",
          webhook_ok: true,
        },
      },
      paused_message: null,
      owner_telegram_id: F.VIP_SELLER_TG,
      owner_name: "Продавец VIP",
      app_url: null,
      archived_at: null,
      bot_token: encrypt(F.VIP_BOT_TOKEN, F.SECRETS_KEY),
      subscription_plan: "basic",
      subscription_expires_at: null,
      created_at: now,
    },
  ]);
  add(
    db,
    "app_settings",
    [
      ["vip_group_id", F.VIP_GROUP],
      ["vip_payment_instructions", "Переведите на Kaspi Gold 4400 0000 0000 0001 и пришлите чек."],
      ["vip_welcome_message", "Добро пожаловать в VIP!"],
    ].map(([key, value]) => vip({ key, value, updated_at: now })),
  );
  const tariff = (r: Record<string, unknown>) =>
    vip({
      description: "",
      currency: "KZT",
      duration_days: 30,
      duration_minutes: null,
      is_active: true,
      created_at: now,
      ...r,
    });
  add(db, "vip_tariffs", [
    tariff({
      id: F.VIP_ENTRY_ID,
      name: "Первый вход",
      price: F.VIP_ENTRY_PRICE,
      is_public: true,
      is_entry: true,
      sort_order: 0,
    }),
    tariff({
      id: F.VIP_RENEW_ID,
      name: "Месяц",
      price: F.VIP_RENEW_PRICE,
      is_public: true,
      is_entry: false,
      sort_order: 1,
    }),
  ]);
  add(db, "vip_subscriptions", []);
  add(db, "vip_member_profiles", []);
  db.unique.vip_member_profiles = [["bot_id", "telegram_id"]];
}
