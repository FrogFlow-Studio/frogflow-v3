import { describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";

vi.mock("@/lib/errors", () => ({ reportError: vi.fn(async () => {}) }));

const { createGiveaway, closeGiveaway } = await import("./giveaway");
const { recordEntry } = await import("./entry");
const { drawWinners } = await import("./draw");
const { giveawayResults } = await import("./results");

const BOT = "11111111-1111-1111-1111-111111111111";
const START = new Date("2026-10-01T10:00:00.000Z");
const ENDS = "2026-10-08T10:00:00.000Z";
const day = (d: number) => new Date(Date.parse(ENDS) + d * 86_400_000).toISOString();

async function seed() {
  const db = fakeDb({ unique: { zernio_logs: [["event_id"]] } });
  const ctx = {
    tenant: { id: BOT, modules: { blocked: true }, ownerTelegramId: null, settings: {} },
    db,
  } as unknown as TenantContext;
  const g = await createGiveaway(
    ctx,
    {
      title: "Осень",
      prize: "Открытки",
      channel: "telegram",
      conditions: "",
      endsAt: ENDS,
      winners: 1,
      subscribeChannel: "@my_channel",
      excludeBlocked: true,
      excludeStaff: true,
    },
    START,
  );
  // u_1 — старый покупатель бота, u_2 и u_3 пришли с розыгрышем.
  db.tables.bot_users = [
    { bot_id: BOT, user_key: "u_1", telegram_id: 1, created_at: "2026-05-01T00:00:00.000Z" },
    { bot_id: BOT, user_key: "u_2", telegram_id: 2, created_at: "2026-10-03T00:00:00.000Z" },
    { bot_id: BOT, user_key: "u_3", telegram_id: 3, created_at: "2026-10-04T00:00:00.000Z" },
  ];
  for (const i of [1, 2, 3])
    await recordEntry(
      ctx,
      g,
      { userKey: `u_${i}`, telegramId: i, channel: "telegram" },
      new Date("2026-10-05T00:00:00.000Z"),
    );
  return { db, ctx, g };
}

const order = (id: number, tg: number, status: string, at: string, total = 1000, extra = {}) => ({
  id,
  bot_id: BOT,
  telegram_id: tg,
  status,
  total,
  paid_amount: 0,
  currency: "KZT",
  fulfillment_kind: "digital",
  created_at: at,
  ...extra,
});

describe("итоги розыгрыша", () => {
  it("участники, новые покупатели, подписка и выручка только по оплаченным за 14 дней", async () => {
    const { db, ctx, g } = await seed();
    db.tables.orders = [
      order(1, 1, "delivered", day(2), 5000),
      order(2, 2, "delivered", day(10), 3000),
      order(3, 2, "awaiting_payment", day(3), 9999), // не оплачен — не считается
      order(4, 3, "cancelled", day(1), 7777), // отменён — не считается
      order(5, 1, "delivered", day(20), 4000), // позже 14 дней — не считается
      order(6, 1, "delivered", day(-1), 2000), // до конца приёма — не считается
      order(7, 99, "delivered", day(1), 1234), // не участник
      order(8, 3, "in_production", day(2), 6000, {
        fulfillment_kind: "physical",
        paid_amount: 1500,
      }),
    ];
    const r = await giveawayResults(ctx, g.id, new Date(day(30)));
    expect(r).toMatchObject({
      participants: 3,
      eligible: null,
      newBuyers: 2,
      subscribed: 3,
      buyers: 3,
      orders: 3,
      window: { closed: true, days: 14 },
    });
    expect(r.revenue).toEqual({ KZT: { revenue: 5000 + 3000 + 1500, orders: 3 } });
  });

  it("окно ещё идёт: учитывается только прошедшее время, closed = false", async () => {
    const { db, ctx, g } = await seed();
    db.tables.orders = [
      order(1, 1, "delivered", day(2), 5000),
      order(2, 2, "delivered", day(10), 3000),
    ];
    const r = await giveawayResults(ctx, g.id, new Date(day(5)));
    expect(r.window.closed).toBe(false);
    expect(r.orders).toBe(1);
    expect(r.revenue.KZT).toEqual({ revenue: 5000, orders: 1 });
  });

  it("до конца приёма заказов в итоге нет; после выбора виден допущенный список", async () => {
    const { db, ctx, g } = await seed();
    db.tables.orders = [order(1, 1, "delivered", day(-1), 5000)];
    await closeGiveaway(ctx, g.id, START);
    const early = await giveawayResults(ctx, g.id, new Date(day(-2)));
    expect(early.orders).toBe(0);
    await drawWinners(ctx, g.id, async () => true, new Date(day(1)));
    const r = await giveawayResults(ctx, g.id, new Date(day(1)));
    expect(r.eligible).toBe(3);
  });

  it("без условия подписки поле subscribed пусто; чужой id — ошибка", async () => {
    const { ctx } = await seed();
    const g2 = await createGiveaway(
      ctx,
      {
        title: "Без подписки",
        prize: "Приз",
        channel: "telegram",
        conditions: "",
        endsAt: ENDS,
        winners: 1,
        subscribeChannel: "",
        excludeBlocked: true,
        excludeStaff: true,
      },
      START,
    );
    expect((await giveawayResults(ctx, g2.id, new Date(day(1)))).subscribed).toBeNull();
    await expect(giveawayResults(ctx, "nonexist", new Date(day(1)))).rejects.toThrow();
  });
});
