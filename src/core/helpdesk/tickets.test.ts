import { describe, expect, it } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { openTicketNumbers } from "@/core/inbox/inbox";
import { createTicket, listTickets, openTicketFor, TICKET_SEQ_KEY, updateTicket } from "./tickets";

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
