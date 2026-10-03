import { describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { referralPercent, rewardReferrerIfFirstDelivery } from "@/core/referrals/referrals";
import { COPY } from "./copy";
import type { TelegramApi } from "./api";
import { notifyReferralReward } from "./referral-notify";

/** Награда пригласившему: одно сообщение на его языке из любого пути выдачи; сбой чтения процента — ошибка. */
const BOT = "bot-1";
const GRANT = { telegramId: 7, code: "REF-ABC", percent: 12 };

function setup(locale?: string) {
  const db = fakeDb();
  db.tables.bot_users = [{ telegram_id: 7, state: locale ? { locale } : {} }];
  const ctx = {
    tenant: { id: BOT, modules: { referral: true }, settings: { default_locale: "en" } },
    db,
  } as unknown as TenantContext;
  const sent: Array<Record<string, unknown>> = [];
  const api = {
    call: vi.fn(async (_m: string, p: Record<string, unknown>) => {
      sent.push(p);
      return { ok: true, result: {} };
    }),
  } as unknown as TelegramApi;
  return { db, ctx, api, sent };
}

describe("сообщение о награде пригласившему", () => {
  it("уходит один раз на языке пригласившего, а без его языка — на языке магазина", async () => {
    const kk = setup("kk");
    await notifyReferralReward(kk.ctx, GRANT, kk.api);
    expect(kk.sent).toEqual([
      { chat_id: 7, text: COPY.kk.referralReward(12, "REF-ABC"), parse_mode: "HTML" },
    ]);
    const none = setup();
    await notifyReferralReward(none.ctx, GRANT, none.api);
    expect(none.sent[0]!.text).toBe(COPY.en.referralReward(12, "REF-ABC"));
  });

  it("нет награды или нет бота — ничего не отправляется; сбой отправки не рвёт выдачу", async () => {
    const s = setup("ru");
    await notifyReferralReward(s.ctx, null, s.api);
    await notifyReferralReward(s.ctx, GRANT, null);
    expect(s.sent).toHaveLength(0);
    const failing = {
      call: vi.fn(async () => {
        throw new Error("network");
      }),
    } as unknown as TelegramApi;
    await expect(notifyReferralReward(s.ctx, GRANT, failing)).resolves.toBeUndefined();
  });
});

describe("процент реферальной скидки", () => {
  function brokenSettings() {
    const { db, ctx } = setup();
    const broken: unknown = new Proxy(() => undefined, {
      get: (_t, prop) =>
        prop === "then"
          ? (ok: (v: unknown) => unknown) => ok({ data: null, error: { message: "boom" } })
          : () => broken,
    });
    const bad = new Proxy(db, {
      get: (t, prop, r) =>
        prop === "from"
          ? (n: string) => (n === "app_settings" ? broken : t.from(n))
          : Reflect.get(t, prop, r),
    });
    return { ...ctx, db: bad } as unknown as TenantContext;
  }

  it("сбой чтения настройки — ошибка, а не 10 %", async () => {
    await expect(referralPercent(brokenSettings())).rejects.toThrow(/referral_discount_percent/);
  });

  it("не задан — 10 %, задан — как в настройке", async () => {
    const s = setup();
    expect(await referralPercent(s.ctx)).toBe(10);
    s.db.tables.app_settings = [{ bot_id: BOT, key: "referral_discount_percent", value: "15" }];
    expect(await referralPercent(s.ctx)).toBe(15);
  });

  it("при сбое чтения процента награда возвращается в «ожидает» и не теряется", async () => {
    const s = setup();
    s.db.tables.referrals = [
      {
        id: "r1",
        bot_id: BOT,
        referrer_telegram_id: 7,
        referred_telegram_id: 8,
        status: "pending",
        created_at: "2026-10-01T00:00:00Z",
      },
    ];
    s.db.tables.orders = [
      { id: 1, telegram_id: 8, status: "delivered", created_at: "2026-10-02T00:00:00Z" },
    ];
    const bad = brokenSettings();
    // Свои таблицы — из той же подставной базы, чтобы проверить откат статуса.
    (bad as { db: unknown }).db = new Proxy(s.db, {
      get: (t, prop, r) =>
        prop === "from"
          ? (n: string) =>
              n === "app_settings"
                ? (brokenSettings() as unknown as { db: { from: (x: string) => unknown } }).db.from(
                    n,
                  )
                : t.from(n)
          : Reflect.get(t, prop, r),
    });
    await expect(rewardReferrerIfFirstDelivery(bad, 8)).rejects.toThrow();
    expect(s.db.tables.referrals![0]!.status).toBe("pending");
  });
});
