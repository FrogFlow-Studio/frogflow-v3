import { describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { countWaiting, lastWaitlistRun, notifyWaitlist, waitingCustomers } from "./waitlist";

const BOT = "00000000-0000-0000-0000-000000000001";
const PRODUCT = "p-1";
const NOW = Date.parse("2026-10-04T10:00:00Z");

function setup(users: Record<string, unknown>[]) {
  const db = fakeDb({ unique: { app_settings: [["key"]] } });
  db.tables.app_settings = [];
  db.tables.manager_chat_messages = [];
  db.tables.bot_users = users.map((u, i) => ({
    user_key: `tg_${i + 1}`,
    telegram_id: i + 1,
    platform: "telegram",
    state: { waitlist: [PRODUCT, "other"] },
    ...u,
  }));
  const ctx = {
    tenant: { id: BOT, modules: { waitlist: true }, settings: {} },
    db,
  } as unknown as TenantContext;
  return { db, ctx };
}

const waitlistOf = (row: Record<string, unknown>) =>
  (row.state as { waitlist?: string[] }).waitlist ?? [];

describe("рассылка листа ожидания", () => {
  it("заблокированному продавцом сообщение не уходит, товар остаётся в его списке", async () => {
    const { db, ctx } = setup([{}, {}]);
    (ctx.tenant.modules as Record<string, boolean>).blocked = true;
    db.tables.blocked_users = [{ bot_id: BOT, telegram_id: 1 }];
    const send = vi.fn(async () => true);
    expect(await notifyWaitlist(ctx, PRODUCT, send)).toMatchObject({ notified: 1, failed: 0 });
    expect(send).toHaveBeenCalledTimes(1);
    expect(waitlistOf(db.tables.bot_users![0]!)).toEqual([PRODUCT, "other"]);
    expect(waitlistOf(db.tables.bot_users![1]!)).toEqual(["other"]);
  });

  it("два одновременных возврата в продажу — каждому ждущему одно сообщение", async () => {
    const { db, ctx } = setup([{}, {}, {}]);
    const send = vi.fn(async () => true);
    const [a, b] = await Promise.all([
      notifyWaitlist(ctx, PRODUCT, send),
      notifyWaitlist(ctx, PRODUCT, send),
    ]);
    expect(send).toHaveBeenCalledTimes(3);
    expect(a.notified + b.notified).toBe(3);
    // Товар убран из списка, остальное в списке цело.
    for (const row of db.tables.bot_users!) expect(waitlistOf(row)).toEqual(["other"]);
  });

  it("не затирает чужое: state покупателя сохраняет остальные поля", async () => {
    const { db, ctx } = setup([
      { state: { waitlist: [PRODUCT], locale: "kk", last_marketing_at: "x" } },
    ]);
    await notifyWaitlist(ctx, PRODUCT, async () => true);
    // Место в общем потолке маркетинга занято (К4); остальные поля на месте.
    expect(db.tables.bot_users![0]!.state).toMatchObject({ waitlist: [], locale: "kk" });
    expect(
      typeof (db.tables.bot_users![0]!.state as { last_marketing_at: string }).last_marketing_at,
    ).toBe("string");
    expect(
      (db.tables.bot_users![0]!.state as { last_marketing_at: string }).last_marketing_at,
    ).not.toBe("x");
  });

  it("отправка не дошла — «не дошло», в очереди не остаётся, повтора нет", async () => {
    const { db, ctx } = setup([{}]);
    const send = vi.fn(async () => false);
    expect(await notifyWaitlist(ctx, PRODUCT, send)).toMatchObject({ notified: 0, failed: 1 });
    expect(waitlistOf(db.tables.bot_users![0]!)).toEqual(["other"]);
    expect(await notifyWaitlist(ctx, PRODUCT, send)).toMatchObject({ notified: 0, failed: 0 });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("Direct вне окна 24 часа — «не дошло» без отправки; внутри окна — одно сообщение", async () => {
    const { db, ctx } = setup([
      { platform: "instagram", user_key: "ig_a", telegram_id: -1 },
      { platform: "instagram", user_key: "ig_b", telegram_id: -2 },
    ]);
    const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();
    db.tables.manager_chat_messages = [
      { id: "m1", bot_id: BOT, telegram_id: -1, direction: "in", created_at: hoursAgo(30) },
      { id: "m2", bot_id: BOT, telegram_id: -2, direction: "in", created_at: hoursAgo(2) },
    ];
    const send = vi.fn(async () => true);
    const r = await notifyWaitlist(ctx, PRODUCT, send, { now: () => NOW });
    expect(r).toMatchObject({ notified: 1, failed: 1 });
    expect(send).toHaveBeenCalledTimes(1);
    expect((send.mock.calls[0] as unknown as [{ userKey: string }])[0].userKey).toBe("ig_b");
    for (const row of db.tables.bot_users!) expect(waitlistOf(row)).toEqual(["other"]);
  });

  it("бюджет времени: остаток не теряется и уходит со следующим запуском", async () => {
    const { db, ctx } = setup([{}, {}, {}, {}]);
    let t = 0;
    const send = vi.fn(async () => {
      t += 40_000;
      return true;
    });
    const first = await notifyWaitlist(ctx, PRODUCT, send, { now: () => t, budgetMs: 90_000 });
    expect(first).toMatchObject({ notified: 3, left: 1 });
    expect(await lastWaitlistRun(ctx, PRODUCT)).toMatchObject({ notified: 3, left: 1 });
    const waiting = db.tables.bot_users!.filter((r) => waitlistOf(r).includes(PRODUCT));
    expect(waiting).toHaveLength(1);

    t = 0;
    const second = await notifyWaitlist(ctx, PRODUCT, send, { now: () => t, budgetMs: 90_000 });
    expect(second).toMatchObject({ notified: 1, left: 0 });
    expect(send).toHaveBeenCalledTimes(4);
  });
});

describe("общий потолок маркетинга: «товар появился» (К4)", () => {
  const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

  it("покупателю, получившему другое маркетинговое сообщение за сутки, не пишем: он остаётся в списке и в «left»", async () => {
    const { db, ctx } = setup([
      { state: { waitlist: [PRODUCT], last_marketing_at: hoursAgo(2) } },
      { state: { waitlist: [PRODUCT] } },
    ]);
    const send = vi.fn(async () => true);
    const r = await notifyWaitlist(ctx, PRODUCT, send);
    expect(r).toMatchObject({ notified: 1, failed: 0, left: 1 });
    expect(send).toHaveBeenCalledTimes(1);
    expect(waitlistOf(db.tables.bot_users![0]!)).toEqual([PRODUCT]);
    expect(waitlistOf(db.tables.bot_users![1]!)).toEqual([]);
    // Через сутки место освободилось: оставшемуся уйдёт со следующим прогоном.
    (db.tables.bot_users![0]!.state as Record<string, unknown>).last_marketing_at = hoursAgo(25);
    expect(await notifyWaitlist(ctx, PRODUCT, send)).toMatchObject({ notified: 1, left: 0 });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("сообщение занимает место в потолке: второй товар в тот же день тому же покупателю не уходит", async () => {
    const { db, ctx } = setup([{ state: { waitlist: [PRODUCT, "p-2"] } }]);
    const send = vi.fn(async () => true);
    await notifyWaitlist(ctx, PRODUCT, send);
    expect(await notifyWaitlist(ctx, "p-2", send)).toMatchObject({ notified: 0, left: 1 });
    expect(send).toHaveBeenCalledTimes(1);
    expect(waitlistOf(db.tables.bot_users![0]!)).toEqual(["p-2"]);
  });

  it("два крона разом на двух товарах одного покупателя — уходит одно сообщение", async () => {
    const { ctx } = setup([{ state: { waitlist: [PRODUCT, "p-2"] } }]);
    const send = vi.fn(async () => true);
    const [a, b] = await Promise.all([
      notifyWaitlist(ctx, PRODUCT, send),
      notifyWaitlist(ctx, "p-2", send),
    ]);
    expect(send).toHaveBeenCalledTimes(1);
    expect(a.notified + b.notified).toBe(1);
    expect(a.left + b.left).toBe(1);
  });

  it("потолок «0» в «Рассылках» снимает ограничение", async () => {
    const { db, ctx } = setup([{ state: { waitlist: [PRODUCT], last_marketing_at: hoursAgo(1) } }]);
    db.tables.app_settings = [{ key: "marketing_daily_cap", value: "0" }];
    const send = vi.fn(async () => true);
    expect(await notifyWaitlist(ctx, PRODUCT, send)).toMatchObject({ notified: 1, left: 0 });
  });

  it("отправка могла дойти, но не подтвердилась — место занято, в списке не остаётся, повтора нет", async () => {
    const { db, ctx } = setup([{ state: { waitlist: [PRODUCT] } }]);
    const send = vi.fn(async () => false);
    await notifyWaitlist(ctx, PRODUCT, send);
    await notifyWaitlist(ctx, PRODUCT, send);
    expect(send).toHaveBeenCalledTimes(1);
    expect(waitlistOf(db.tables.bot_users![0]!)).toEqual([]);
    expect(
      (db.tables.bot_users![0]!.state as { last_marketing_at?: string }).last_marketing_at,
    ).toBeTruthy();
  });

  it("закрытое окно Direct сообщения не требует: место в потолке не тратится", async () => {
    const { db, ctx } = setup([
      { platform: "instagram", user_key: "ig_a", telegram_id: -1, state: { waitlist: [PRODUCT] } },
    ]);
    db.tables.manager_chat_messages = [
      {
        id: "m1",
        bot_id: BOT,
        telegram_id: -1,
        direction: "in",
        created_at: new Date(Date.now() - 30 * 3_600_000).toISOString(),
      },
    ];
    const send = vi.fn(async () => true);
    expect(await notifyWaitlist(ctx, PRODUCT, send)).toMatchObject({ notified: 0, failed: 1 });
    expect(send).not.toHaveBeenCalled();
    expect(
      (db.tables.bot_users![0]!.state as { last_marketing_at?: string }).last_marketing_at,
    ).toBeUndefined();
  });
});

describe("лист ожидания: ошибки чтения", () => {
  const broken = {
    tenant: { id: BOT, modules: { waitlist: true }, settings: {} },
    db: {
      from: () => {
        const q: Record<string, unknown> = {};
        const chain = () => q;
        for (const m of ["select", "contains", "order", "limit", "gt"]) q[m] = chain;
        q.then = (resolve: (v: unknown) => unknown) =>
          resolve({ data: null, error: { message: "boom" }, count: null });
        return q;
      },
    },
  } as unknown as TenantContext;

  it("не прочиталось — ошибка, а не «0 ждут»", async () => {
    await expect(countWaiting(broken, PRODUCT)).rejects.toMatchObject({
      message: expect.stringContaining("Лист ожидания"),
    });
    await expect(waitingCustomers(broken, PRODUCT)).rejects.toBeTruthy();
  });

  it("ждущих считает по списку покупателей", async () => {
    const { ctx } = setup([{}, { state: { waitlist: ["other"] } }]);
    expect(await countWaiting(ctx, PRODUCT)).toBe(1);
  });
});
