import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { createTicket, updateTicket } from "./tickets";
import { isMyTicketsWord, MY_TICKETS_SHOWN, myTickets } from "./mine";

const ctxWith = () => {
  const db = fakeDb({ unique: { app_settings: [["bot_id", "key"]] } });
  return { db, ctx: { tenant: { id: "bot" }, db } as unknown as TenantContext };
};
const ask = (telegramId: number, subject: string) => ({
  telegramId,
  customerName: "Аня",
  platform: "telegram",
  subject,
});

describe("мои обращения", () => {
  it("только свои: номер, статус, тема; чужие и заметки не видны", async () => {
    const { ctx } = ctxWith();
    const mine = (await createTicket(ctx, ask(1, "Где заказ?"))).ticket;
    await createTicket(ctx, ask(2, "Чужой вопрос"));
    await updateTicket(ctx, mine.id, { assignee: "boss", note: "внутренняя заметка" }, "admin:o");
    const r = await myTickets(ctx, 1);
    expect(r.tickets).toMatchObject([{ number: 1, status: "open", subject: "Где заказ?" }]);
    expect(JSON.stringify(r)).not.toContain("внутренняя заметка");
    expect(JSON.stringify(r)).not.toContain("boss");
    expect(r.canAppend).toBe(true);
    expect((await myTickets(ctx, 3)).tickets).toEqual([]);
  });

  it("закрытые не дают «дописать»; «ждём покупателя» — дают", async () => {
    const { ctx } = ctxWith();
    const t = (await createTicket(ctx, ask(1, "Вопрос"))).ticket;
    await updateTicket(ctx, t.id, { status: "closed" }, "admin:o");
    expect((await myTickets(ctx, 1)).canAppend).toBe(false);
    await updateTicket(ctx, t.id, { status: "waiting" }, "admin:o");
    expect((await myTickets(ctx, 1)).canAppend).toBe(true);
  });

  it("показаны последние десять, остальное — числом «ещё»", async () => {
    const { ctx } = ctxWith();
    for (let i = 0; i < MY_TICKETS_SHOWN + 3; i++) {
      const t = (await createTicket(ctx, ask(1, `Вопрос ${i}`))).ticket;
      await updateTicket(ctx, t.id, { status: "closed" }, "admin:o");
    }
    const r = await myTickets(ctx, 1);
    expect(r.tickets).toHaveLength(MY_TICKETS_SHOWN);
    expect(r.more).toBe(3);
  });

  it("слова Direct: целое сообщение на четырёх языках, не вхождение", () => {
    for (const w of ["Мои обращения", "менің өтініштерім", "My requests!", "murojaatlarim"])
      expect(isMyTicketsWord(w), w).toBe(true);
    expect(isMyTicketsWord("а где мои обращения по заказу?")).toBe(false);
  });
});
