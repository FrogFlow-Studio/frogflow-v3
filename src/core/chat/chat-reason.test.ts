import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { listMessages, recordMessage } from "./chat";

const BOT = "11111111-1111-1111-1111-111111111111";

function setup() {
  const db = fakeDb({ rpc: { manager_chat_touch: () => undefined } });
  db.tables.manager_chat_state = [{ bot_id: BOT, telegram_id: 7, active: true, unread_count: 0 }];
  db.tables.manager_chat_messages = [];
  db.tables.manager_chat_reasons = [];
  const ctx = {
    tenant: { id: BOT, modules: { manager_chat: true } },
    db,
  } as unknown as TenantContext;
  return { ctx, db };
}

/** База, в которой таблицы причин ещё нет (миграция 19-13 не применена). */
function withoutReasonsTable(db: FakeDb) {
  const calls: string[] = [];
  const real = db.from.bind(db);
  const stub = db as unknown as { from: (t: string) => unknown };
  const missing = { data: null, error: { code: "PGRST205", message: "could not find the table" } };
  stub.from = (table: string) => {
    if (table !== "manager_chat_reasons") return real(table);
    calls.push(table);
    const q: Record<string, unknown> = {};
    const chain = () => q;
    for (const m of ["select", "insert", "in", "eq"]) q[m] = chain;
    q.then = (ok: (v: unknown) => unknown) => Promise.resolve(missing).then(ok);
    return q;
  };
  return calls;
}

afterEach(() => vi.useRealTimers());

describe("«Почему бот так ответил»: причина в журнале чата", () => {
  it("ответ бота хранит причину, реплика покупателя и менеджера — нет", async () => {
    const { ctx, db } = setup();
    const base = { telegramId: 7, direction: "out" as const };
    await recordMessage(ctx, {
      ...base,
      sender: "bot",
      text: "Вот каталог",
      reason: "step=idle cmd=catalog",
    });
    await recordMessage(ctx, {
      ...base,
      sender: "manager",
      text: "Здравствуйте",
      reason: "step=idle",
    });
    await recordMessage(ctx, {
      telegramId: 7,
      direction: "in",
      sender: "customer",
      text: "каталог",
      reason: "x",
    });
    expect(db.tables.manager_chat_messages).toHaveLength(3);
    expect(db.tables.manager_chat_reasons).toMatchObject([
      { bot_id: BOT, reason: "step=idle cmd=catalog" },
    ]);
    const { messages } = await listMessages(ctx, 7);
    expect(messages.find((m) => m.sender === "bot")?.reason).toBe("step=idle cmd=catalog");
  });

  it("таблицы причин нет: сообщение записано, страница читается, таблицу 10 минут не трогаем", async () => {
    vi.useFakeTimers();
    const { ctx, db } = setup();
    const calls = withoutReasonsTable(db);
    await recordMessage(ctx, {
      telegramId: 7,
      direction: "out",
      sender: "bot",
      text: "Вот каталог",
      reason: "step=idle cmd=catalog",
    });
    expect(db.tables.manager_chat_messages).toHaveLength(1);
    expect(calls).toEqual(["manager_chat_reasons"]);
    await recordMessage(ctx, {
      telegramId: 7,
      direction: "out",
      sender: "bot",
      text: "ещё",
      reason: "a",
    });
    const { messages } = await listMessages(ctx, 7);
    expect(messages).toHaveLength(2);
    expect(messages.every((m) => m.reason === undefined)).toBe(true);
    expect(calls).toEqual(["manager_chat_reasons"]);
  });
});
