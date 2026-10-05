import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { notifyWaitlist } from "@/core/waitlist/waitlist";

/** Догоняющая рассылка «товар появился»: настоящая выдача очереди и общий потолок, подменена только отправка. */
const sends: string[] = [];
const send = vi.fn(async (c: { userKey: string }) => {
  sends.push(c.userKey);
  return true;
});
vi.mock("./notify.server", () => ({
  notifyBackInStock: (ctx: TenantContext, p: { id: string }, opts: { budgetMs?: number }) =>
    notifyWaitlist(ctx, p.id, send, opts),
}));
const { runWaitlistCatchup } = await import("./catchup.server");

const BOT = "00000000-0000-0000-0000-000000000001";
const P1 = "p-1";
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
let db: FakeDb;
const ctx = (modules: Record<string, boolean> = { waitlist: true }) =>
  ({ tenant: { id: BOT, modules, settings: {} }, db }) as unknown as TenantContext;
const record = (left: number) =>
  JSON.stringify({ notified: 0, failed: 0, left, at: "2026-10-05T00:00:00Z" });
const waitlistOf = (key: string) =>
  ((db.tables.bot_users!.find((r) => r.user_key === key)!.state as { waitlist?: string[] })
    .waitlist ?? []) as string[];

beforeEach(() => {
  sends.length = 0;
  send.mockClear();
  db = fakeDb({ unique: { app_settings: [["key"]] } });
  db.tables.manager_chat_messages = [];
  db.tables.app_settings = [
    { key: "auto_messages_v3", value: "true" },
    { key: `waitlist_last:${P1}`, value: record(1) },
  ];
  db.tables.products = [{ id: P1, bot_id: BOT, name: "Торт", is_active: true, stock_quantity: 5 }];
  db.tables.bot_users = [
    {
      user_key: "tg_1",
      telegram_id: 1,
      platform: "telegram",
      state: { waitlist: [P1], last_marketing_at: hoursAgo(30) },
    },
  ];
});

describe("догоняющая рассылка листа ожидания", () => {
  it("тому, кому не хватило места в потолке, уходит, когда оно освободилось; итог сбрасывается", async () => {
    // Сутки ещё не прошли: место занято, покупатель остаётся.
    (db.tables.bot_users![0]!.state as Record<string, unknown>).last_marketing_at = hoursAgo(3);
    expect(await runWaitlistCatchup(ctx())).toMatchObject({ products: 1, notified: 0, left: 1 });
    expect(waitlistOf("tg_1")).toEqual([P1]);
    // Прошли сутки — уходит, список очищен.
    (db.tables.bot_users![0]!.state as Record<string, unknown>).last_marketing_at = hoursAgo(25);
    expect(await runWaitlistCatchup(ctx())).toMatchObject({ notified: 1, left: 0 });
    expect(sends).toEqual(["tg_1"]);
    expect(waitlistOf("tg_1")).toEqual([]);
  });

  it("два крона разом и повтор — одно сообщение", async () => {
    const [a, b] = await Promise.all([runWaitlistCatchup(ctx()), runWaitlistCatchup(ctx())]);
    expect(sends).toEqual(["tg_1"]);
    expect([a, b].reduce((n, x) => n + ("notified" in x ? x.notified : 0), 0)).toBe(1);
    await runWaitlistCatchup(ctx());
    expect(sends).toEqual(["tg_1"]);
  });

  it("товара нет в наличии — не пишем, итог остаётся до возврата в продажу", async () => {
    db.tables.products![0]!.stock_quantity = 0;
    expect(await runWaitlistCatchup(ctx())).toMatchObject({ products: 0 });
    expect(send).not.toHaveBeenCalled();
    expect(waitlistOf("tg_1")).toEqual([P1]);
    db.tables.products![0]!.stock_quantity = 3;
    expect(await runWaitlistCatchup(ctx())).toMatchObject({ notified: 1 });
  });

  it("товар удалён — итог сбрасывается, крон его больше не берёт", async () => {
    db.tables.products = [];
    await runWaitlistCatchup(ctx());
    expect(send).not.toHaveBeenCalled();
    expect(await runWaitlistCatchup(ctx())).toMatchObject({ products: 0 });
  });

  it("выключены «Новые автосообщения» или модуль — ничего не уходит", async () => {
    db.tables.app_settings = db.tables.app_settings!.filter((r) => r.key !== "auto_messages_v3");
    expect(await runWaitlistCatchup(ctx())).toEqual({ skipped: "auto messages off" });
    expect(await runWaitlistCatchup(ctx({}))).toEqual({ skipped: "module off" });
    expect(send).not.toHaveBeenCalled();
  });

  it("берёт только товары с «осталось»: прочие итоги не трогает", async () => {
    db.tables.app_settings!.push({ key: "waitlist_last:p-9", value: record(0) });
    db.tables.products!.push({
      id: "p-9",
      bot_id: BOT,
      name: "Пирог",
      is_active: true,
      stock_quantity: 5,
    });
    await runWaitlistCatchup(ctx());
    expect(sends).toEqual(["tg_1"]);
  });
});
