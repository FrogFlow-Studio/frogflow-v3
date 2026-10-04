/**
 * Страница итогов розыгрыша (shop18-k.spec.ts): «Кондитерская К18» с модулем giveaways и двумя
 * розыгрышами (один идёт, у другого есть победитель), плюс такой же магазин на прежней платформе.
 */
import * as F from "../fixtures.ts";
import type { StubDb } from "../pg-stub.ts";
import { add, encrypt } from "./util.ts";

export function seedShop18K(db: StubDb, now: string) {
  const bot = (id: string, slug: string, served: "v1" | "v2", n: number) => ({
    id,
    bot_name: F.K18_SHOP_NAME,
    status: "active",
    vertical: "digital",
    modules: { shop: true, giveaways: true },
    settings: {
      served_by: served,
      default_locale: "ru",
      slug,
      telegram: { username: `e2e_k18_bot${n}`, webhook_ok: true },
    },
    paused_message: null,
    owner_telegram_id: 500000300 + n,
    owner_name: "Продавец К18",
    app_url: null,
    archived_at: null,
    bot_token: encrypt(`70000030${n}:E2E-k18-token`, F.SECRETS_KEY),
    subscription_plan: "business",
    subscription_expires_at: null,
    created_at: now,
  });
  add(db, "bots", [
    bot(F.K18_SHOP_ID, F.K18_SHOP_SLUG, "v2", 1),
    bot(F.K18_V1_SHOP_ID, F.K18_V1_SHOP_SLUG, "v1", 2),
  ]);
  const ends = new Date(Date.parse(now) + 7 * 86_400_000).toISOString();
  const past = new Date(Date.parse(now) - 7 * 86_400_000).toISOString();
  const giveaway = (id: string, title: string, extra: Record<string, unknown>) =>
    JSON.stringify({
      id,
      rev: 1,
      title,
      prize: "Набор открыток",
      channel: "telegram",
      conditions: "Нажмите кнопку в боте",
      winners: 1,
      subscribeChannel: "",
      excludeBlocked: true,
      excludeStaff: true,
      createdAt: past,
      updatedAt: past,
      ...extra,
    });
  const own = <T extends object>(id: string, r: T) => ({ bot_id: id, ...r });
  for (const id of [F.K18_SHOP_ID, F.K18_V1_SHOP_ID]) {
    add(db, "app_settings", [
      own(id, { key: "shop_name", value: F.K18_SHOP_NAME, updated_at: now }),
      own(id, {
        key: `giveaway:${F.K18_OPEN_ID}`,
        value: giveaway(F.K18_OPEN_ID, F.K18_OPEN_TITLE, { endsAt: ends, status: "open" }),
        updated_at: now,
      }),
      own(id, {
        key: `giveaway:${F.K18_DRAWN_ID}`,
        value: giveaway(F.K18_DRAWN_ID, F.K18_DRAWN_TITLE, {
          endsAt: past,
          status: "drawn",
          result: {
            seed: F.K18_SEED,
            listHash: F.K18_HASH,
            entered: 3,
            eligible: 2,
            drawnAt: past,
            winners: [{ userKey: "telegram:e2e-k18", telegramId: 700018, channel: "telegram" }],
            rerolls: [],
          },
        }),
        updated_at: now,
      }),
    ]);
  }
  add(db, "bot_users", [
    own(F.K18_SHOP_ID, {
      id: "e2e00000-0000-4000-8000-00000000180c",
      user_key: "telegram:e2e-k18",
      telegram_id: 700018,
      platform: "telegram",
      first_name: F.K18_WINNER_FIRST_NAME,
    }),
  ]);
  const entry = (k: number, giveawayId: string) =>
    own(F.K18_SHOP_ID, {
      event_id: `giveaway:${giveawayId}:entry:telegram:e2e-k18-${k}`,
      event_type: "giveaway.entry",
      status: "event",
      payload: { giveaway_id: giveawayId, user_key: `telegram:e2e-k18-${k}`, channel: "telegram" },
      created_at: now,
    });
  add(db, "zernio_logs", [
    entry(1, F.K18_OPEN_ID),
    entry(2, F.K18_OPEN_ID),
    entry(1, F.K18_DRAWN_ID),
    entry(2, F.K18_DRAWN_ID),
    entry(3, F.K18_DRAWN_ID),
  ]);
}
