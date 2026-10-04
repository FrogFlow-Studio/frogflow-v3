import { describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { blockedAmong } from "@/core/customers/customers";
import { runWinback } from "./winback";

const BOT = "00000000-0000-0000-0000-000000000001";
// Полдень в Алматы — крон шлёт только днём.
const NOW = new Date("2026-09-27T07:00:00Z");
const DAY = 86_400_000;
const ago = (days: number) => new Date(NOW.getTime() - days * DAY).toISOString();

function setup(count: number, state: Record<string, unknown> = {}) {
  const db = fakeDb();
  db.tables.app_settings = [
    { key: "winback", value: JSON.stringify({ enabled: true, days1: 30 }) },
  ];
  db.tables.orders = [];
  db.tables.blocked_users = [];
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
