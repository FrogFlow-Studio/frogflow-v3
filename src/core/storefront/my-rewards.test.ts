import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { myRewards } from "./my-rewards";

const BOT = "00000000-0000-0000-0000-0000000000bb";

function setup(modules: Record<string, boolean>, username: string | null = "shop_bot") {
  const db = fakeDb();
  db.tables.app_settings = [
    { bot_id: BOT, key: "loyalty_earn_percent", value: "7" },
    { bot_id: BOT, key: "loyalty_max_redeem_percent", value: "50" },
    {
      bot_id: BOT,
      key: "loyalty_tiers",
      value: JSON.stringify([
        { name: "Серебро", from: 0, percent: 5 },
        { name: "Золото", from: 100000, percent: 10 },
      ]),
    },
  ];
  db.tables.bot_users = [
    { bot_id: BOT, telegram_id: 111, user_key: "telegram:111", loyalty_points: 1250 },
  ];
  db.tables.orders = [
    { id: 1, bot_id: BOT, telegram_id: 111, status: "delivered", total: 40000, currency: "KZT" },
    // Чужой заказ и неоплаченный в сумму уровня не входят.
    { id: 2, bot_id: BOT, telegram_id: 222, status: "delivered", total: 900000, currency: "KZT" },
    {
      id: 3,
      bot_id: BOT,
      telegram_id: 111,
      status: "awaiting_payment",
      total: 90000,
      currency: "KZT",
    },
  ];
  db.tables.referrals = [
    {
      id: "r1",
      bot_id: BOT,
      referrer_telegram_id: 111,
      status: "rewarded",
      reward_promo_code: "REF-A",
    },
    {
      id: "r2",
      bot_id: BOT,
      referrer_telegram_id: 111,
      status: "pending",
      reward_promo_code: null,
    },
    {
      id: "r3",
      bot_id: BOT,
      referrer_telegram_id: 222,
      status: "rewarded",
      reward_promo_code: "REF-B",
    },
  ];
  db.tables.promo_codes = [
    { bot_id: BOT, code: "REF-A", used_count: 1, max_uses: 1 },
    { bot_id: BOT, code: "REF-B", used_count: 0, max_uses: 1 },
  ];
  const ctx = {
    tenant: { id: BOT, modules, settings: username ? { telegram: { username } } : {} },
    db,
  } as unknown as TenantContext;
  return ctx;
}

describe("мои баллы и приглашения на витрине", () => {
  it("баланс, уровень и «до следующего» — только по своим выданным заказам", async () => {
    const r = await myRewards(setup({ loyalty: true, referral: true }), 111);
    expect(r.points).toEqual({
      balance: 1250,
      currency: "KZT",
      earnPercent: 5,
      maxRedeemPercent: 50,
      tier: { name: "Серебро", percent: 5 },
      next: { name: "Золото", remaining: 60000 },
    });
  });

  it("ссылка и итоги приглашений — свои; чужие коды не видны", async () => {
    const r = await myRewards(setup({ loyalty: true, referral: true }), 111);
    expect(r.invite).toEqual({
      link: "https://t.me/shop_bot?start=ref_111",
      came: 2,
      bought: 1,
      codes: [{ code: "REF-A", used: true }],
    });
  });

  it("модули выключены или у бота нет имени — блока нет, а не пустые нули", async () => {
    expect(await myRewards(setup({}), 111)).toEqual({ points: null, invite: null });
    const noName = await myRewards(setup({ loyalty: true, referral: true }, null), 111);
    expect(noName.invite).toBeNull();
    expect(noName.points?.balance).toBe(1250);
  });

  it("покупатель без записи: ноль баллов, но уровень с нулевым порогом уже его", async () => {
    const r = await myRewards(setup({ loyalty: true }), 999);
    expect(r.points).toMatchObject({ balance: 0, tier: { name: "Серебро" } });
  });
});
