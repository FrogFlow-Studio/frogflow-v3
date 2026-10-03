import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { registerReferral } from "./referrals";

/** Н3: ссылка «Пригласить друга» работает только на нового покупателя. */
const BOT = "11111111-1111-1111-1111-111111111111";

function setup(orders: unknown[] = []) {
  const db = fakeDb();
  db.tables.bot_users = [{ telegram_id: 1 }, { telegram_id: 2 }];
  db.tables.referrals = [];
  db.tables.promo_codes = [];
  db.tables.app_settings = [];
  db.tables.orders = orders as never[];
  const ctx = {
    tenant: { id: BOT, modules: { referral: true }, settings: {} },
    db,
  } as unknown as TenantContext;
  return { db, ctx };
}

describe("реферальная ссылка и давний покупатель", () => {
  it("у приглашённого уже есть заказ — ни записи, ни промокода", async () => {
    const { db, ctx } = setup([{ id: "o1", telegram_id: 2, status: "delivered" }]);
    expect(await registerReferral(ctx, 2, "1")).toBeNull();
    expect(db.tables.referrals).toHaveLength(0);
    expect(db.tables.promo_codes).toHaveLength(0);
  });

  it("два постоянных покупателя меняются ссылками — оба отказа", async () => {
    const { db, ctx } = setup([
      { id: "o1", telegram_id: 1, status: "delivered" },
      { id: "o2", telegram_id: 2, status: "paid" },
    ]);
    expect(await registerReferral(ctx, 2, "1")).toBeNull();
    expect(await registerReferral(ctx, 1, "2")).toBeNull();
    expect(db.tables.promo_codes).toHaveLength(0);
  });

  it("новый покупатель без заказов получает приветственный код", async () => {
    const { db, ctx } = setup([{ id: "o1", telegram_id: 1, status: "delivered" }]);
    const gift = await registerReferral(ctx, 2, "1");
    expect(gift?.code).toMatch(/^WELCOME-/);
    expect(db.tables.referrals).toHaveLength(1);
  });
});
