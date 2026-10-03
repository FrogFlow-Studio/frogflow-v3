import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import {
  listSubscriptionProducts,
  parseSubscriptionDays,
  renewalText,
  runSubscriptionRenewals,
  saveSubscriptionDays,
  subscriptionOff,
  withSubscriptionOff,
  type Renewal,
} from "./subscription";

const BOT = "b41a34cb-7944-441b-8f71-503184fc0f1f";
const DAY = 86400_000;
// Полдень в Алматы — днём, крон работает.
const NOW = new Date("2026-09-28T07:00:00Z");
const ago = (d: number) => new Date(NOW.getTime() - d * DAY).toISOString();

function shop(modules: Record<string, boolean> = { subscriptions: true }) {
  const db = fakeDb({
    unique: { app_settings: [["bot_id", "key"]], zernio_logs: [["event_id"]] },
  });
  db.tables.app_settings = [];
  db.tables.zernio_logs = [];
  db.tables.bot_users = [];
  db.tables.blocked_users = [];
  db.tables.orders = [];
  db.tables.order_items = [];
  const ctx = {
    tenant: { id: BOT, modules, settings: {} },
    timezone: "Asia/Almaty",
    db,
  } as unknown as TenantContext;
  return { ctx, db };
}

let seq = 100;
function order(
  db: ReturnType<typeof shop>["db"],
  o: { tg: number; productId: string; daysAgo: number; status?: string },
) {
  const id = ++seq;
  db.tables.orders!.push({
    id,
    bot_id: BOT,
    telegram_id: o.tg,
    status: o.status ?? "delivered",
    platform: "telegram",
    total: 5000,
    currency: "KZT",
    created_at: ago(o.daysAgo),
  });
  db.tables.order_items!.push({
    id: `i${id}`,
    order_id: id,
    product_id: o.productId,
    product_variant_id: null,
    name_snapshot: "Коробка месяца",
    quantity: 1,
    price_snapshot: 5000,
  });
  return id;
}

async function run(ctx: TenantContext) {
  const sent: Renewal[] = [];
  const r = await runSubscriptionRenewals(
    ctx,
    async (x) => {
      sent.push(x);
      return true;
    },
    NOW,
  );
  return { r, sent };
}

describe("товары-подписки", () => {
  it("период — целое от 7 до 365 дней, иначе товар не подписка", async () => {
    expect(parseSubscriptionDays('{"days":30}')).toBe(30);
    expect(parseSubscriptionDays('{"days":3}')).toBeNull();
    expect(parseSubscriptionDays('{"days":"x"}')).toBeNull();
    expect(parseSubscriptionDays("")).toBeNull();
    const { ctx } = shop();
    expect(await saveSubscriptionDays(ctx, "p1", 30)).toBe(30);
    expect(await saveSubscriptionDays(ctx, "p2", 14)).toBe(14);
    expect(await saveSubscriptionDays(ctx, "p2", null)).toBeNull();
    expect([...(await listSubscriptionProducts(ctx)).entries()]).toEqual([["p1", 30]]);
  });

  it("отказ покупателя — список товаров в состоянии, без дублей", () => {
    const s1 = withSubscriptionOff({}, "p1", true);
    const s2 = withSubscriptionOff(s1, "p1", true);
    expect(s2.sub_off).toEqual(["p1"]);
    expect(subscriptionOff({ state: s2 }, "p1")).toBe(true);
    expect(subscriptionOff({ state: withSubscriptionOff(s2, "p1", false) }, "p1")).toBe(false);
    expect(subscriptionOff(null, "p1")).toBe(false);
  });

  it("через N дней после оплаченного заказа — одно напоминание, повторный крон молчит", async () => {
    const { ctx } = shop();
    await saveSubscriptionDays(ctx, "p1", 30);
    const id = order(ctx.db as never, { tg: 11, productId: "p1", daysAgo: 30.5 });
    const first = await run(ctx);
    expect(first.r).toEqual({ sent: 1, failed: 0 });
    expect(first.sent[0]).toMatchObject({ productId: "p1", days: 30, name: "Коробка месяца" });
    expect(first.sent[0]!.order.id).toBe(id);
    const again = await run(ctx);
    expect(again.r).toEqual({ sent: 0, failed: 0 });
  });

  it("два крона одновременно — одно напоминание и одна отметка", async () => {
    const { ctx, db } = shop();
    await saveSubscriptionDays(ctx, "p1", 30);
    order(db, { tg: 11, productId: "p1", daysAgo: 30.5 });
    const [a, b] = await Promise.all([run(ctx), run(ctx)]);
    expect(a.sent.length + b.sent.length).toBe(1);
    expect(db.tables.zernio_logs).toHaveLength(1);
  });

  it("рано, поздно, неоплачен, уже продлён или отказался — не напоминаем", async () => {
    const { ctx, db } = shop();
    await saveSubscriptionDays(ctx, "p1", 30);
    order(db, { tg: 1, productId: "p1", daysAgo: 20 }); // рано
    order(db, { tg: 2, productId: "p1", daysAgo: 40 }); // поздно
    order(db, { tg: 3, productId: "p1", daysAgo: 31, status: "awaiting_payment" });
    order(db, { tg: 4, productId: "p1", daysAgo: 31 });
    order(db, { tg: 4, productId: "p1", daysAgo: 1, status: "awaiting_confirmation" }); // продлил
    order(db, { tg: 5, productId: "p1", daysAgo: 31 });
    db.tables.bot_users!.push({
      user_key: "tg:5",
      platform: "telegram",
      telegram_id: 5,
      state: { sub_off: ["p1"] },
    });
    order(db, { tg: 6, productId: "other", daysAgo: 31 }); // не подписка
    expect((await run(ctx)).r).toEqual({ sent: 0, failed: 0 });
  });

  it("модуль выключен или ночь — крон ничего не делает", async () => {
    const off = shop({});
    expect((await run(off.ctx)).r.skipped).toBe("module off");
    const { ctx } = shop();
    const night = await runSubscriptionRenewals(
      ctx,
      async () => true,
      new Date("2026-09-28T20:00:00Z"),
    );
    expect(night.skipped).toBe("night");
  });

  it("текст напоминания — товар, срок и как продлить", () => {
    expect(renewalText("Коробка", 30, "Продлить: https://x")).toBe(
      "🔁 Пора продлить подписку «Коробка» — прошло 30 дн. с прошлой оплаты.\nПродлить: https://x",
    );
  });
});
