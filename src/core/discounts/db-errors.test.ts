import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { rewardReferrerIfFirstDelivery } from "@/core/referrals/referrals";
import { findValidGift, findValidPromoCode, loyaltyBalance, returnOrderCodes } from "./discounts";

const BOT = "00000000-0000-0000-0000-000000000001";

/** Запросы к `table` отвечают ошибкой базы, остальные идут в подставную базу. */
function breakTable(db: ReturnType<typeof fakeDb>, table: string) {
  const broken: unknown = new Proxy(() => undefined, {
    get: (_t, prop) =>
      prop === "then"
        ? (ok: (v: unknown) => unknown) =>
            ok({ data: null, count: null, error: { message: "boom" } })
        : () => broken,
  });
  return new Proxy(db, {
    get: (t, prop, r) =>
      prop === "from"
        ? (name: string) => (name === table ? broken : t.from(name))
        : Reflect.get(t, prop, r),
  });
}

function ctxOf(db: unknown) {
  return {
    tenant: { id: BOT, modules: { referral: true, loyalty: true } },
    db,
  } as unknown as TenantContext;
}

describe("скидки: сбой чтения не равен «кода нет»", () => {
  it("промокод, сертификат, баланс баллов — сбой, а не not_found / 0", async () => {
    const db = fakeDb();
    await expect(findValidPromoCode(ctxOf(breakTable(db, "promo_codes")), "X")).rejects.toThrow(
      /promo/,
    );
    await expect(findValidGift(ctxOf(breakTable(db, "gift_certificates")), "X")).rejects.toThrow(
      /gift/,
    );
    await expect(loyaltyBalance(ctxOf(breakTable(db, "bot_users")), 1)).rejects.toThrow(/loyalty/);
  });

  it("возврат кодов отменённого заказа: сбой чтения счётчика не маскируется под «возвращать нечего»", async () => {
    const db = fakeDb();
    await expect(returnOrderCodes(ctxOf(breakTable(db, "promo_codes")), 5, "CODE")).rejects.toThrow(
      /promo/,
    );
  });
});

describe("рефералы: награда не выдаётся по упавшему чтению", () => {
  function seed() {
    const db = fakeDb();
    db.tables.referrals = [
      {
        id: "ref1",
        bot_id: BOT,
        referrer_telegram_id: 7,
        referred_telegram_id: 8,
        status: "pending",
        created_at: "2026-09-01T00:00:00Z",
        rewarded_at: null,
        reward_promo_code: null,
      },
    ];
    db.tables.orders = [
      {
        id: 1,
        bot_id: BOT,
        telegram_id: 8,
        status: "delivered",
        created_at: "2026-09-02T00:00:00Z",
      },
    ];
    db.tables.promo_codes = [];
    return db;
  }

  it("не прочитали заказы — награда не выдана, приглашение остаётся pending", async () => {
    const db = seed();
    await expect(rewardReferrerIfFirstDelivery(ctxOf(breakTable(db, "orders")), 8)).rejects.toThrow(
      /referral/,
    );
    expect(db.tables.referrals![0]!.status).toBe("pending");
    expect(db.tables.promo_codes).toHaveLength(0);
  });

  it("код выпустить не удалось — отметка «награждён» снимается, награда уйдёт на следующей выдаче", async () => {
    const db = seed();
    await expect(
      rewardReferrerIfFirstDelivery(ctxOf(breakTable(db, "promo_codes")), 8),
    ).rejects.toThrow(/referral/);
    expect(db.tables.referrals![0]!.status).toBe("pending");
    const ok = await rewardReferrerIfFirstDelivery(ctxOf(db), 8);
    expect(ok?.telegramId).toBe(7);
    expect(db.tables.referrals![0]!.status).toBe("rewarded");
    expect(db.tables.promo_codes).toHaveLength(1);
  });
});
