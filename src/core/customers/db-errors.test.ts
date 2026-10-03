import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { getCustomer, isBlocked } from "./customers";
import { isOptedOut } from "./opt-out";
import { openTicketFor } from "@/core/helpdesk/tickets";
import { markRead, isManagerConnected, listConversations, listMessages } from "@/core/chat/chat";
import { setPhysicalStatus } from "@/core/orders/admin";

const BOT = "00000000-0000-0000-0000-000000000001";

/** Запросы к `table` отвечают ошибкой базы, остальные идут в подставную базу. */
function breakTable(db: ReturnType<typeof fakeDb>, table: string) {
  const broken: unknown = new Proxy(() => undefined, {
    get: (_t, prop) =>
      prop === "then"
        ? (ok: (v: unknown) => unknown) =>
            ok({ data: null, count: null, error: { message: "boom" } })
        : () => broken,
  });
  return new Proxy(db, {
    get: (t, prop, r) =>
      prop === "from"
        ? (name: string) => (name === table ? broken : t.from(name))
        : Reflect.get(t, prop, r),
  });
}

const ctxOf = (db: unknown) =>
  ({ tenant: { id: BOT, modules: { blocked: true } }, db }) as unknown as TenantContext;

describe("покупатели, чат, поддержка, заказы: сбой чтения не равен «нет данных»", () => {
  it("отписка, блокировка, карточка покупателя — сбой, а не «не отписан / не заблокирован / нет»", async () => {
    const db = fakeDb();
    db.tables.bot_users = [{ user_key: "tg:1", telegram_id: 1, opt_out: true }];
    await expect(isOptedOut(ctxOf(breakTable(db, "bot_users")), "tg:1")).rejects.toThrow(/отписка/);
    await expect(getCustomer(ctxOf(breakTable(db, "bot_users")), "tg:1")).rejects.toThrow(
      /Покупатели/,
    );
    await expect(isBlocked(ctxOf(breakTable(db, "blocked_users")), 1)).rejects.toThrow(
      /Покупатели/,
    );
    expect(await isOptedOut(ctxOf(db), "tg:1")).toBe(true);
  });

  it("чат и обращения: не прочитали — сбой, не «менеджер не подключён» и не «обращения нет»", async () => {
    const db = fakeDb();
    await expect(
      isManagerConnected(ctxOf(breakTable(db, "manager_chat_state")), 1),
    ).rejects.toThrow(/Чат/);
    await expect(markRead(ctxOf(breakTable(db, "manager_chat_state")), 1)).rejects.toThrow(/Чат/);
    await expect(listConversations(ctxOf(breakTable(db, "manager_chat_state")))).rejects.toThrow(
      /Чат/,
    );
    await expect(listMessages(ctxOf(breakTable(db, "manager_chat_messages")), 1)).rejects.toThrow(
      /Чат/,
    );
    await expect(openTicketFor(ctxOf(breakTable(db, "zernio_logs")), 1)).rejects.toThrow(
      /Поддержка/,
    );
  });

  it("смена статуса физического заказа: сбой записи — ошибка, баллы не начисляются", async () => {
    const db = fakeDb();
    db.tables.orders = [{ id: 1, bot_id: BOT, status: "ready", telegram_id: 1, total: 100 }];
    await expect(
      setPhysicalStatus(ctxOf(breakTable(db, "orders")), 1, "ready", "delivered"),
    ).rejects.toThrow(/Заказы/);
    expect(db.tables.orders[0]!.status).toBe("ready");
  });
});
