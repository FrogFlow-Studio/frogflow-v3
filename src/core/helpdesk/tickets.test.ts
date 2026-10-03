import { describe, expect, it } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { openTicketNumbers } from "@/core/inbox/inbox";
import {
  createTicket,
  getTicket,
  listTickets,
  markRatingAsked,
  openTicketFor,
  ratingStats,
  rateTicket,
  ticketAwaitingRating,
  TICKET_SEQ_KEY,
  updateTicket,
} from "./tickets";

const BOT = "11111111-1111-1111-1111-111111111111";
function ctxWith(): { ctx: TenantContext; db: FakeDb } {
  const db = fakeDb({ unique: { app_settings: [["bot_id", "key"]] } });
  return { ctx: { tenant: { id: BOT }, db } as unknown as TenantContext, db };
}
const ask = (telegramId: number, subject = "Где мой заказ?") => ({
  telegramId,
  customerName: "Аня",
  platform: "telegram",
  subject,
});

describe("обращения: номера", () => {
  it("номер не повторяется после чистки старых журналов", async () => {
    const { ctx, db } = ctxWith();
    expect((await createTicket(ctx, ask(1))).ticket.number).toBe(1);
    expect((await createTicket(ctx, ask(2))).ticket.number).toBe(2);
    // Чистка журналов удалила обе строки — счёт «строк + 1» начал бы заново.
    db.tables.zernio_logs = [];
    expect((await createTicket(ctx, ask(3))).ticket.number).toBe(3);
  });

  it("одновременные обращения разных покупателей получают разные номера", async () => {
    const { ctx } = ctxWith();
    const all = await Promise.all([1, 2, 3, 4, 5].map((id) => createTicket(ctx, ask(id))));
    const numbers = all.map((r) => r.ticket.number).sort((a, b) => a - b);
    expect(numbers).toEqual([1, 2, 3, 4, 5]);
  });

  it("счётчика ещё нет, а обращения уже были — продолжает с самого большого номера", async () => {
    const { ctx, db } = ctxWith();
    db.tables.zernio_logs = [
      {
        id: "old",
        bot_id: BOT,
        event_id: "ticket:old",
        event_type: "ticket",
        status: "closed",
        payload: { number: 41, telegram_id: 9 },
        created_at: "2026-09-01T00:00:00Z",
      },
    ];
    expect((await createTicket(ctx, ask(1))).ticket.number).toBe(42);
    expect(db.tables.app_settings!.find((r) => r.key === TICKET_SEQ_KEY)!.value).toBe("42");
  });

  it("второе сообщение при открытом обращении дописывается в него, номер не расходуется", async () => {
    const { ctx } = ctxWith();
    const first = await createTicket(ctx, ask(1));
    const again = await createTicket(ctx, ask(1, "Уточняю: заказ №5"));
    expect(again).toMatchObject({ created: false, ticket: { number: first.ticket.number } });
    expect(again.ticket.history.at(-1)).toMatchObject({
      action: "message",
      note: "Уточняю: заказ №5",
    });
    expect((await createTicket(ctx, ask(2))).ticket.number).toBe(2);
  });
});

describe("обращения: статус «ждём покупателя»", () => {
  it("хранится как waiting, не pending: крон добора v1 помечает pending обработанными", async () => {
    const { ctx, db } = ctxWith();
    const { ticket } = await createTicket(ctx, ask(1));
    await updateTicket(ctx, ticket.id, { status: "waiting" }, "admin:owner");
    expect(db.tables.zernio_logs![0]!.status).toBe("waiting");
    expect((await listTickets(ctx, "waiting")).map((t) => t.number)).toEqual([1]);
  });

  it("старое pending читается как waiting и считается незакрытым", async () => {
    const { ctx, db } = ctxWith();
    const { ticket } = await createTicket(ctx, ask(7));
    db.tables.zernio_logs![0]!.status = "pending";
    expect((await listTickets(ctx, "waiting"))[0]).toMatchObject({
      id: ticket.id,
      status: "waiting",
    });
    expect((await openTicketFor(ctx, 7))?.id).toBe(ticket.id);
    expect((await openTicketNumbers(ctx, [7])).get(7)).toEqual([ticket.number]);
  });

  it("смена статуса, ответственного и заметка пишутся в историю", async () => {
    const { ctx } = ctxWith();
    const { ticket } = await createTicket(ctx, ask(1));
    const next = await updateTicket(
      ctx,
      ticket.id,
      { status: "closed", assignee: "manager1", note: "Отправили трек" },
      "admin:owner",
    );
    expect(next).toMatchObject({ status: "closed", assignee: "manager1" });
    expect(next!.history.map((h) => h.action)).toEqual([
      "opened",
      "status:closed",
      "assignee:manager1",
      "note",
    ]);
    // Закрытое больше не «открытое»: следующий вопрос — новое обращение.
    expect(await openTicketFor(ctx, 1)).toBeNull();
    expect((await createTicket(ctx, ask(1))).created).toBe(true);
  });
});

describe("обращения: оценка после закрытия", () => {
  async function closed(ctx: TenantContext, tg = 1) {
    const { ticket } = await createTicket(ctx, ask(tg));
    await updateTicket(ctx, ticket.id, { status: "closed" }, "admin:owner");
    await markRatingAsked(ctx, ticket.id);
    return ticket;
  }

  it("оценка пишется один раз: повторное нажатие и вторая цифра ничего не меняют", async () => {
    const { ctx } = ctxWith();
    const t = await closed(ctx);
    expect(await rateTicket(ctx, t.id, 1, 2)).toBe("rated");
    expect(await rateTicket(ctx, t.id, 1, 5)).toBe("already");
    const [got] = await listTickets(ctx, "closed");
    expect(got).toMatchObject({ rating: 2 });
    expect(got!.history.filter((h) => h.action.startsWith("rating:"))).toHaveLength(1);
  });

  it("два нажатия одновременно: выигрывает одно, оценка одна", async () => {
    const { ctx } = ctxWith();
    const t = await closed(ctx);
    const r = await Promise.all([rateTicket(ctx, t.id, 1, 4), rateTicket(ctx, t.id, 1, 1)]);
    expect(r.filter((x) => x === "rated")).toHaveLength(1);
    const [got] = await listTickets(ctx, "closed");
    expect([4, 1]).toContain(got!.rating);
  });

  it("чужое, не закрытое и неверная цифра — invalid, ничего не пишется", async () => {
    const { ctx, db } = ctxWith();
    const t = await closed(ctx, 1);
    expect(await rateTicket(ctx, t.id, 2, 5)).toBe("invalid");
    expect(await rateTicket(ctx, t.id, 1, 6)).toBe("invalid");
    expect(await rateTicket(ctx, t.id, 1, 0)).toBe("invalid");
    const open = (await createTicket(ctx, ask(3))).ticket;
    expect(await rateTicket(ctx, open.id, 3, 5)).toBe("invalid");
    expect(db.tables.app_settings!.some((r) => String(r.key).startsWith("ticket_rating:"))).toBe(
      false,
    );
  });

  it("цифра в Direct относится к обращению этого покупателя, которое просили оценить; через неделю — нет", async () => {
    const { ctx } = ctxWith();
    const mine = await closed(ctx, 1);
    await closed(ctx, 2);
    const now = new Date();
    expect((await ticketAwaitingRating(ctx, 1, now))?.id).toBe(mine.id);
    expect(await ticketAwaitingRating(ctx, 9, now)).toBeNull();
    expect(
      await ticketAwaitingRating(ctx, 1, new Date(now.getTime() + 8 * 24 * 3600 * 1000)),
    ).toBeNull();
    await rateTicket(ctx, mine.id, 1, 5);
    expect(await ticketAwaitingRating(ctx, 1, now)).toBeNull();
  });

  it("средняя оценка и низкие оценки для страницы «Обращения»", async () => {
    const { ctx } = ctxWith();
    const a = await closed(ctx, 1);
    const b = await closed(ctx, 2);
    const c = await closed(ctx, 3);
    await rateTicket(ctx, a.id, 1, 5);
    await rateTicket(ctx, b.id, 2, 1);
    await closed(ctx, 4); // не оценено — в среднее не входит
    expect(await rateTicket(ctx, c.id, 3, 2)).toBe("rated");
    const st = await ratingStats(ctx);
    expect(st).toMatchObject({ count: 3, average: 2.7, lowCount: 2 });
    expect(st.low.map((t) => t.rating).sort()).toEqual([1, 2]);
  });
});

describe("обращения: одновременные записи не затирают друг друга", () => {
  it("отметка просьбы об оценке и заметка продавца ложатся обе", async () => {
    const { ctx } = ctxWith();
    const { ticket } = await createTicket(ctx, ask(1));
    await updateTicket(ctx, ticket.id, { status: "closed" }, "admin:owner");
    await Promise.all([
      markRatingAsked(ctx, ticket.id),
      updateTicket(ctx, ticket.id, { note: "позвонили" }, "admin:owner"),
    ]);
    const t = (await getTicket(ctx, ticket.id))!;
    expect(t.ratingAskedAt).not.toBeNull();
    expect(t.history.map((h) => h.action)).toContain("note");
  });

  it("смена статуса продавцом и дописанное покупателем сообщение ложатся обе", async () => {
    const { ctx } = ctxWith();
    const { ticket } = await createTicket(ctx, ask(1));
    await Promise.all([
      updateTicket(ctx, ticket.id, { status: "waiting" }, "admin:owner"),
      createTicket(ctx, ask(1, "Алло?")),
    ]);
    const t = (await getTicket(ctx, ticket.id))!;
    const actions = t.history.map((h) => h.action);
    expect(actions).toContain("status:waiting");
    expect(actions).toContain("message");
    expect(t.rev).toBeGreaterThanOrEqual(2);
  });

  it("оценка и закрытие/заметка не теряют друг друга", async () => {
    const { ctx } = ctxWith();
    const { ticket } = await createTicket(ctx, ask(1));
    await updateTicket(ctx, ticket.id, { status: "closed" }, "admin:owner");
    const [r] = await Promise.all([
      rateTicket(ctx, ticket.id, 1, 5),
      updateTicket(ctx, ticket.id, { assignee: "manager1" }, "admin:owner"),
    ]);
    expect(r).toBe("rated");
    const t = (await getTicket(ctx, ticket.id))!;
    expect(t).toMatchObject({ rating: 5, assignee: "manager1" });
  });
});
