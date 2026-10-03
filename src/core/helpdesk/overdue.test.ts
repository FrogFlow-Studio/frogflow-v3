import { describe, expect, it } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { createTicket, updateTicket } from "./tickets";
import { claimOverdue, overdueAmong, parseOverdueHours, remindOverdue } from "./overdue";

const BOT = "11111111-1111-1111-1111-111111111111";
const NOW = new Date("2026-10-03T12:00:00Z");
const ago = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

function setup() {
  const db: FakeDb = fakeDb({
    unique: { app_settings: [["bot_id", "key"]], zernio_logs: [["bot_id", "event_id"]] },
  });
  return { db, ctx: { tenant: { id: BOT }, db } as unknown as TenantContext };
}

/** Обращение, где покупатель написал `hours` часов назад. */
async function ticketAgo(ctx: TenantContext, db: FakeDb, telegramId: number, hours: number) {
  const { ticket } = await createTicket(ctx, {
    telegramId,
    customerName: "Аня",
    platform: "telegram",
    subject: "Где заказ?",
  });
  const row = db.tables.zernio_logs!.find((r) => r.id === ticket.id)!;
  const p = row.payload as { history: { at: string }[] };
  p.history[0]!.at = ago(hours);
  row.created_at = ago(hours);
  return ticket;
}

const managerSays = (db: FakeDb, telegramId: number, at: string) =>
  (db.tables.manager_chat_messages ??= []).push({
    id: `m${db.tables.manager_chat_messages?.length ?? 0}`,
    bot_id: BOT,
    telegram_id: telegramId,
    sender: "manager",
    created_at: at,
  });

describe("просроченные обращения", () => {
  it("порог читается только из списка значений", () => {
    expect(parseOverdueHours("4")).toBe(4);
    expect(parseOverdueHours("3")).toBe(0);
    expect(parseOverdueHours(null)).toBe(0);
  });

  it("открытое без ответа дольше порога напоминает один раз; повторный проход молчит", async () => {
    const { db, ctx } = setup();
    await ticketAgo(ctx, db, 1, 5);
    const sent: number[] = [];
    const notify = async (o: { ticket: { number: number } }) => void sent.push(o.ticket.number);
    expect(await remindOverdue(ctx, 4, notify, NOW)).toEqual({ overdue: 1, reminded: 1 });
    expect(await remindOverdue(ctx, 4, notify, NOW)).toMatchObject({ reminded: 0 });
    expect(sent).toEqual([1]);
  });

  it("два крона одновременно: напоминание одно", async () => {
    const { db, ctx } = setup();
    await ticketAgo(ctx, db, 1, 5);
    let n = 0;
    const notify = async () => void n++;
    await Promise.all([remindOverdue(ctx, 4, notify, NOW), remindOverdue(ctx, 4, notify, NOW)]);
    expect(n).toBe(1);
    expect(await claimOverdue(ctx, `${db.tables.zernio_logs![0]!.id}:x`)).toBe(true);
  });

  it("не просрочено: свежее, с ответом продавца, «ждём покупателя», закрытое, выключено, слишком старое", async () => {
    const { db, ctx } = setup();
    await ticketAgo(ctx, db, 1, 1); // свежее
    const answered = await ticketAgo(ctx, db, 2, 6);
    managerSays(db, 2, ago(5)); // продавец ответил
    const waiting = await ticketAgo(ctx, db, 3, 6);
    await updateTicket(ctx, waiting.id, { status: "waiting" }, "admin:o");
    const closed = await ticketAgo(ctx, db, 4, 6);
    await updateTicket(ctx, closed.id, { status: "closed" }, "admin:o");
    await ticketAgo(ctx, db, 5, 24 * 9); // девять суток — не заваливаем старьём
    const sent: number[] = [];
    const r = await remindOverdue(ctx, 4, async (o) => void sent.push(o.ticket.telegramId), NOW);
    expect(sent).toEqual([]);
    expect(r.reminded).toBe(0);
    expect(answered.number).toBe(2);
    expect(await remindOverdue(ctx, 0, async () => {}, NOW)).toEqual({ overdue: 0, reminded: 0 });
  });

  it("покупатель дописал уже после напоминания — новый отрезок, новое напоминание", async () => {
    const { db, ctx } = setup();
    await ticketAgo(ctx, db, 1, 10);
    let n = 0;
    const notify = async () => void n++;
    await remindOverdue(ctx, 4, notify, NOW);
    const row = db.tables.zernio_logs!.find((r) => String(r.event_id).startsWith("ticket:"))!;
    (row.payload as { history: unknown[] }).history.push({
      at: ago(5),
      actor: "customer",
      action: "message",
    });
    await remindOverdue(ctx, 4, notify, NOW);
    expect(n).toBe(2);
  });

  it("подсветка списка: просрочено только то, что без ответа дольше порога", async () => {
    const { db, ctx } = setup();
    const a = await ticketAgo(ctx, db, 1, 9);
    const b = await ticketAgo(ctx, db, 2, 1);
    const { listTickets } = await import("./tickets");
    const list = await listTickets(ctx, "open");
    const ids = (await overdueAmong(ctx, list, 8, NOW)).map((o) => o.ticket.id);
    expect(ids).toEqual([a.id]);
    expect(ids).not.toContain(b.id);
  });
});
