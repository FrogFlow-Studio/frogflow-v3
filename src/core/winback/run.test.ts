import { describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { blockedAmong } from "@/core/customers/customers";
import { autoMessageStats } from "@/core/automsg/stats";
import { runWinback } from "./winback";

const BOT = "00000000-0000-0000-0000-000000000001";
// Полдень в Алматы — крон шлёт только днём.
const NOW = new Date("2026-09-27T07:00:00Z");
const DAY = 86_400_000;
const ago = (days: number) => new Date(NOW.getTime() - days * DAY).toISOString();

function setup(count: number, state: Record<string, unknown> = {}) {
  const db = fakeDb({ unique: { zernio_logs: [["event_id"]] } });
  db.tables.app_settings = [
    { key: "winback", value: JSON.stringify({ enabled: true, days1: 30 }) },
  ];
  db.tables.orders = [];
  db.tables.blocked_users = [];
  db.tables.cart_items = [];
  db.tables.zernio_logs = [];
  db.tables.bot_users = [];
  for (let tg = 1; tg <= count; tg++) {
    db.tables.orders.push({
      id: tg,
      telegram_id: tg,
      platform: "telegram",
      status: "delivered",
      created_at: ago(40),
    });
    db.tables.bot_users.push({
      user_key: `tg_${tg}`,
      telegram_id: tg,
      platform: "telegram",
      first_name: "Аня",
      opt_out: false,
      state: { ...state },
      created_at: ago(100),
    });
  }
  const ctx = {
    tenant: { id: BOT, modules: { winback: true, blocked: true }, settings: {} },
    timezone: "Asia/Almaty",
    db,
  } as unknown as TenantContext;
  return { db, ctx };
}

describe("возврат клиентов: запись и блокировки", () => {
  it("отметка шага не затирает то, что бот записал, пока шло сообщение", async () => {
    const { db, ctx } = setup(1, { locale: "kk" });
    const send = vi.fn(async () => {
      // бот (или v1) записал своё между чтением покупателя и отметкой шага
      const row = db.tables.bot_users![0]!;
      row.state = { ...(row.state as object), cart_note: "от бота", locale: "en" };
      return true;
    });
    expect((await runWinback(ctx, send, NOW)).sent).toBe(1);
    const state = db.tables.bot_users![0]!.state as Record<string, unknown>;
    expect(state).toMatchObject({
      locale: "en",
      cart_note: "от бота",
      winback: { order_id: 1, step: 1 },
    });
  });

  it("заблокированному не пишем; блокировки читаются одним запросом на кусок покупателей", async () => {
    const { db, ctx } = setup(250);
    db.tables.blocked_users = [{ bot_id: BOT, telegram_id: 7 }];
    const from = db.from;
    const tables: string[] = [];
    db.from = (t) => {
      tables.push(t);
      return from(t);
    };
    const sent: number[] = [];
    const r = await runWinback(
      ctx,
      async (c) => {
        sent.push(c.telegramId);
        return true;
      },
      NOW,
    );
    expect(r.sent).toBe(sent.length);
    expect(sent).not.toContain(7);
    // Пачка в 50 сообщений набирается внутри первого куска из 200 покупателей:
    // один запрос блокировок вместо запроса на каждого.
    expect(r.sent).toBe(50);
    expect(tables.filter((t) => t === "blocked_users")).toHaveLength(1);
  });

  it("блокировки не прочитались — ошибка, а не «никто не заблокирован»", async () => {
    const broken = {
      tenant: { id: BOT, modules: { blocked: true } },
      db: {
        from: () => {
          const q: Record<string, unknown> = {};
          q.select = () => q;
          q.in = () => q;
          q.then = (resolve: (v: unknown) => unknown) =>
            resolve({ data: null, error: { message: "boom" } });
          return q;
        },
      },
    } as unknown as TenantContext;
    await expect(blockedAmong(broken, [1, 2])).rejects.toMatchObject({
      message: expect.stringContaining("блокировки"),
    });
  });
});

describe("возврат клиентов: кто уже вернулся", () => {
  const sendAll = () => vi.fn(async () => true);

  it("открытый заказ в ожидании оплаты — не пишем, потолок не тратим, пропуск считается", async () => {
    const { db, ctx } = setup(2);
    db.tables.orders!.push({
      id: 900,
      telegram_id: 1,
      platform: "telegram",
      status: "awaiting_payment",
      created_at: ago(1),
    });
    const send = sendAll();
    const r = await runWinback(ctx, send, NOW);
    expect(r).toMatchObject({ sent: 1, returned: 1 });
    expect(send).toHaveBeenCalledTimes(1);
    const skipped = db.tables.bot_users!.find((u) => u.telegram_id === 1)!;
    expect(skipped.state).toEqual({});
  });

  it("корзина, тронутая за сутки, — не пишем; старая корзина — пишем", async () => {
    const { db, ctx } = setup(2);
    db.tables.cart_items!.push(
      { id: "c1", telegram_id: 1, created_at: new Date(NOW.getTime() - 3_600_000).toISOString() },
      { id: "c2", telegram_id: 2, created_at: ago(3) },
    );
    const sent: number[] = [];
    const r = await runWinback(
      ctx,
      async (c) => {
        sent.push(c.telegramId);
        return true;
      },
      NOW,
    );
    expect(sent).toEqual([2]);
    expect(r.returned).toBe(1);
  });

  it("пропуск отмечается один раз, а не каждый час; в итогах он виден", async () => {
    const { db, ctx } = setup(1);
    db.tables.orders!.push({
      id: 900,
      telegram_id: 1,
      platform: "telegram",
      status: "awaiting_payment",
      created_at: ago(1),
    });
    await runWinback(ctx, sendAll(), NOW);
    await runWinback(ctx, sendAll(), new Date(NOW.getTime() + 3_600_000));
    expect(db.tables.zernio_logs!.filter((e) => e.status === "skipped")).toHaveLength(1);
    const { autoMessageStats } = await import("@/core/automsg/stats");
    const stats = await autoMessageStats(ctx, NOW.getTime() + 2 * 3_600_000);
    expect(stats.winback).toMatchObject({ returned: 1, sent: 0, failed: 0 });
  });
});

describe("возврат клиентов: два крона одновременно", () => {
  // Асинхронная отправка: второй крон успевает дойти до покупателя, пока первый шлёт.
  const slowSend = () =>
    vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 5));
      return true;
    });

  it("потолок по умолчанию (одно в сутки) — одно сообщение", async () => {
    const { db, ctx } = setup(1);
    const send = slowSend();
    await Promise.all([runWinback(ctx, send, NOW), runWinback(ctx, send, NOW)]);
    expect(send).toHaveBeenCalledTimes(1);
    expect((db.tables.bot_users![0]!.state as { winback: { step: number } }).winback.step).toBe(1);
  });

  it("без потолка («0») — всё равно одно сообщение: шаг серии занят до отправки", async () => {
    const { db, ctx } = setup(1);
    db.tables.app_settings!.push({ key: "marketing_daily_cap", value: "0" });
    const send = slowSend();
    const [a, b] = await Promise.all([runWinback(ctx, send, NOW), runWinback(ctx, send, NOW)]);
    expect(send).toHaveBeenCalledTimes(1);
    expect(a.sent + b.sent).toBe(1);
    expect((db.tables.bot_users![0]!.state as { winback: { step: number } }).winback.step).toBe(1);
  });
});

describe("возврат клиентов: окно ответа Instagram и WhatsApp", () => {
  function direct(lastInboundDaysAgo: number | null) {
    const { db, ctx } = setup(1);
    db.tables.bot_users![0]!.platform = "instagram";
    db.tables.manager_chat_messages =
      lastInboundDaysAgo == null
        ? []
        : [{ telegram_id: 1, direction: "in", created_at: ago(lastInboundDaysAgo) }];
    return { db, ctx, row: db.tables.bot_users![0]! };
  }

  it("окно закрыто — не пишем, шаг серии и место в потолке не тратятся, в журнале пропуск", async () => {
    const { db, ctx, row } = direct(30);
    const send = vi.fn(async () => true);
    const r = await runWinback(ctx, send, NOW);
    expect(send).not.toHaveBeenCalled();
    expect(r).toMatchObject({ sent: 0, failed: 0 });
    expect(row.state).toEqual({});
    expect(db.tables.zernio_logs!.map((l) => l.status)).toEqual(["skipped"]);
    // В итогах это «окно закрыто», а не «вернулся сам».
    const stats = await autoMessageStats(ctx, NOW.getTime());
    expect(stats.winback).toMatchObject({ windowClosed: 1, returned: 0, sent: 0, failed: 0 });
    // Повторный прогон не плодит пропуски того же шага.
    await runWinback(ctx, send, new Date(NOW.getTime() + 3_600_000));
    expect(db.tables.zernio_logs).toHaveLength(1);
  });

  it("покупатель ответил — следующий прогон пишет и отмечает шаг", async () => {
    const { ctx, row, db } = direct(30);
    const send = vi.fn(async () => true);
    await runWinback(ctx, send, NOW);
    db.tables.manager_chat_messages = [{ telegram_id: 1, direction: "in", created_at: ago(0.1) }];
    expect((await runWinback(ctx, send, NOW)).sent).toBe(1);
    expect(row.state).toMatchObject({ winback: { order_id: 1, step: 1 } });
  });
});
