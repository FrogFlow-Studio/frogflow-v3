import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { createTicket } from "@/core/helpdesk/tickets";
import { fillQuickReply, quickReplyVars } from "./inbox";

const BOT = "11111111-1111-1111-1111-111111111111";
function setup(modules: Record<string, boolean> = { helpdesk: true }) {
  const db = fakeDb({ unique: { app_settings: [["bot_id", "key"]] } });
  db.tables.bot_users = [
    { user_key: "tg_5", platform: "telegram", telegram_id: 5, first_name: "Анна", state: {} },
    { user_key: "tg_6", platform: "telegram", telegram_id: 6, first_name: "Борис", state: {} },
  ];
  db.tables.orders = [
    { id: 10, order_no: 10, telegram_id: 5, created_at: "2026-10-01T10:00:00Z" },
    { id: 11, order_no: 11, telegram_id: 5, created_at: "2026-10-02T10:00:00Z" },
    { id: 12, order_no: 12, telegram_id: 6, created_at: "2026-10-03T10:00:00Z" },
  ];
  return { db, ctx: { tenant: { id: BOT, modules }, db } as unknown as TenantContext };
}

describe("быстрый ответ: подстановки из базы", () => {
  it("имя, номер ПОСЛЕДНЕГО заказа этого покупателя и номер его открытого обращения", async () => {
    const { ctx } = setup();
    await createTicket(ctx, {
      telegramId: 5,
      customerName: "Анна",
      platform: "telegram",
      subject: "Где?",
    });
    await createTicket(ctx, {
      telegramId: 6,
      customerName: "Борис",
      platform: "telegram",
      subject: "Эй",
    });
    const vars = await quickReplyVars(ctx, 5);
    expect(vars).toEqual({ first_name: "Анна", orderNo: 11, ticketNo: 1 });
    expect(
      fillQuickReply("{name}, по заказу {order} (обращение {ticket}) — отправили.", vars),
    ).toBe("Анна, по заказу №11 (обращение №1) — отправили.");
    expect(await quickReplyVars(ctx, 6)).toMatchObject({ orderNo: 12, ticketNo: 2 });
  });

  it("ни заказов, ни обращений — подстановки убираются без дыр", async () => {
    const { ctx, db } = setup();
    db.tables.orders = [];
    const vars = await quickReplyVars(ctx, 5);
    expect(vars).toEqual({ first_name: "Анна", orderNo: null, ticketNo: null });
    expect(fillQuickReply("{name}, по заказу {order} уже едем.", vars)).toBe(
      "Анна, по заказу уже едем.",
    );
  });

  it("номер обращения со страницы «Обращений» главнее поиска; без модуля «Поддержка» обращения не ищутся", async () => {
    const { ctx } = setup({ helpdesk: false });
    expect((await quickReplyVars(ctx, 5)).ticketNo).toBeNull();
    expect((await quickReplyVars(ctx, 5, 42)).ticketNo).toBe(42);
  });

  it("незнакомый покупатель — только номер обращения, если он задан", async () => {
    const { ctx } = setup();
    expect(await quickReplyVars(ctx, 999, 3)).toEqual({
      first_name: null,
      orderNo: null,
      ticketNo: 3,
    });
  });
});
