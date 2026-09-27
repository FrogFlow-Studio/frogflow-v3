import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { FunnelAcc, funnelChannel, stageRate } from "./funnel";
import { buyerFunnel } from "./funnel.server";

describe("канал покупателя", () => {
  it("по platform, у корзины — по префиксу ключа; ручные и тестовые не считаются", () => {
    expect(funnelChannel("instagram", "ig_1")).toBe("instagram");
    expect(funnelChannel("web", null)).toBe("web");
    expect(funnelChannel(null, "wa_7")).toBe("whatsapp");
    expect(funnelChannel(null, "tg_7")).toBe("telegram");
    expect(funnelChannel(null, "web_ab12")).toBe("web");
    expect(funnelChannel("", null)).toBe("telegram");
    expect(funnelChannel("manual", "manual:abc")).toBeNull();
    expect(funnelChannel(null, "manual:abc")).toBeNull();
    expect(funnelChannel("admin_test", "tg_1")).toBeNull();
  });
});

describe("воронка", () => {
  it("корзина ⊇ заказ ⊇ оплата, покупатель считается один раз", () => {
    const f = new FunnelAcc();
    f.user({ platform: "telegram", user_key: "tg_1" });
    f.user({ platform: "telegram", user_key: "tg_2" });
    f.user({ platform: "telegram", user_key: "tg_3" });
    f.user({ platform: "instagram", user_key: "ig_9" });
    f.cartItem({ user_key: "tg_1", telegram_id: 1 });
    f.cartItem({ user_key: "tg_1", telegram_id: 1 });
    f.cartItem({ user_key: null, telegram_id: 2 });
    // Заказ без строки корзины (корзина уже очищена) — тоже «положил в корзину».
    f.order({ platform: "telegram", user_key: "tg_3", telegram_id: 3, status: "delivered" });
    f.order({ platform: "telegram", user_key: "tg_3", telegram_id: 3, status: "delivered" });
    f.order({ platform: "telegram", user_key: "tg_2", telegram_id: 2, status: "awaiting_payment" });
    f.order({ platform: "instagram", user_key: "ig_9", telegram_id: -5, status: "delivered" });
    f.order({ platform: "manual", user_key: "manual:x", telegram_id: -7, status: "delivered" });
    const [all, tg, ig] = f.rows();
    expect(tg).toEqual({ channel: "telegram", arrived: 3, cart: 3, ordered: 2, paid: 1 });
    expect(ig).toEqual({ channel: "instagram", arrived: 1, cart: 1, ordered: 1, paid: 1 });
    expect(all).toEqual({ channel: "all", arrived: 4, cart: 4, ordered: 3, paid: 2 });
  });

  it("покупатель с сайта: корзина и заказ в одном канале, в «все каналы» один раз", () => {
    const f = new FunnelAcc();
    f.user({ platform: "web", user_key: "web_ab12" });
    f.cartItem({ user_key: "web_ab12", telegram_id: 0 });
    f.order({ platform: "web", user_key: "web_ab12", telegram_id: 0, status: "delivered" });
    const [all, web, ...rest] = f.rows();
    expect(rest).toEqual([]);
    expect(web).toEqual({ channel: "web", arrived: 1, cart: 1, ordered: 1, paid: 1 });
    expect(all).toEqual({ channel: "all", arrived: 1, cart: 1, ordered: 1, paid: 1 });
  });

  it("физический заказ с задатком — оплачен, цифровой на проверке чека — ещё нет", () => {
    const f = new FunnelAcc();
    f.order({
      platform: "telegram",
      user_key: "tg_1",
      telegram_id: 1,
      status: "accepted",
      fulfillment_kind: "physical",
    });
    f.order({
      platform: "telegram",
      user_key: "tg_2",
      telegram_id: 2,
      status: "awaiting_confirmation",
      fulfillment_kind: "digital",
    });
    expect(f.rows()[0]).toMatchObject({ ordered: 2, paid: 1 });
  });

  it("доля перехода: нет базы или больше 100 % — не показываем", () => {
    expect(stageRate(10, 4)).toBe(40);
    expect(stageRate(0, 4)).toBeNull();
    expect(stageRate(2, 5)).toBeNull();
  });
});

describe("большой магазин", () => {
  it("читает постранично: за первой тысячей никто не теряется", async () => {
    const db = fakeDb({ maxRows: 1000 });
    const at = "2026-09-20T10:00:00Z";
    db.tables.bot_users = Array.from({ length: 2500 }, (_, i) => ({
      user_key: `tg_${i}`,
      platform: "telegram",
      created_at: at,
    }));
    db.tables.cart_items = Array.from({ length: 1800 }, (_, i) => ({
      id: `c${String(i).padStart(5, "0")}`,
      user_key: `tg_${i}`,
      telegram_id: i,
      created_at: at,
    }));
    db.tables.orders = Array.from({ length: 1200 }, (_, i) => ({
      id: i + 1,
      user_key: `tg_${i}`,
      telegram_id: i,
      platform: "telegram",
      status: i < 1100 ? "delivered" : "awaiting_payment",
      fulfillment_kind: "digital",
      created_at: at,
    }));
    // Строки вне окна не считаются.
    db.tables.bot_users.push({
      user_key: "tg_old",
      platform: "telegram",
      created_at: "2026-08-01T00:00:00Z",
    });
    const ctx = { db, tenant: { id: "t1" } } as unknown as TenantContext;
    const rows = await buyerFunnel(
      ctx,
      new Date("2026-09-14T00:00:00Z"),
      new Date("2026-09-21T00:00:00Z"),
    );
    expect(rows[0]).toEqual({
      channel: "all",
      arrived: 2500,
      cart: 1800,
      ordered: 1200,
      paid: 1100,
    });
  });
});
