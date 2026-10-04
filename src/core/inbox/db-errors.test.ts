import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { ServerFailure } from "@/lib/server-failure";
import { sendFulfillmentReminders } from "@/core/reminders/fulfillment";
import { inboxEventId, inboxMetaFor, setInboxMeta } from "./inbox";
import { getInboxItem, inboxTotals, listInboxPage } from "./page";

const BOT = "11111111-1111-1111-1111-111111111111";

/** Таблица `table` отвечает ошибкой базы на любой запрос, остальные — как обычно. */
function ctxBroken(table: string, helpdesk = false) {
  const db = fakeDb();
  db.tables.manager_chat_state = [
    {
      bot_id: BOT,
      telegram_id: 1,
      active: false,
      last_message_at: "2026-01-01T00:00:00Z",
      unread_count: 0,
    },
  ];
  db.tables.bot_users = [{ bot_id: BOT, telegram_id: 1, user_key: "k1", platform: "telegram" }];
  db.tables.zernio_logs = [];
  db.tables.orders = [];
  const broken: unknown = new Proxy(() => undefined, {
    get: (_t, prop) =>
      prop === "then"
        ? (ok: (v: unknown) => unknown) =>
            ok({ data: null, count: null, error: { message: "boom" } })
        : () => broken,
  });
  const wrapped = new Proxy(db, {
    get: (t, prop, r) =>
      prop === "from"
        ? (name: string) => (name === table ? broken : t.from(name))
        : Reflect.get(t, prop, r),
  });
  return {
    tenant: {
      id: BOT,
      modules: { helpdesk },
      settings: { admin: { username: "owner", users: [{ username: "anna", role: "manager" }] } },
    },
    db: wrapped,
  } as unknown as TenantContext;
}

const ALL = { status: "all", who: "all", channel: "all" } as const;

describe("сбои базы во входящих: ServerFailure, а не «данных нет»", () => {
  it("учёт диалогов (статус, ответственный) не прочитался — сбой, а не «все открыты»", async () => {
    await expect(inboxMetaFor(ctxBroken("zernio_logs"), [1])).rejects.toBeInstanceOf(ServerFailure);
    await expect(
      listInboxPage(ctxBroken("zernio_logs"), { filter: ALL, me: "" }),
    ).rejects.toBeInstanceOf(ServerFailure);
  });

  it("диалоги, покупатели и счётчики: сбой любой таблицы — сбой", async () => {
    await expect(
      listInboxPage(ctxBroken("manager_chat_state"), { filter: ALL, me: "" }),
    ).rejects.toBeInstanceOf(ServerFailure);
    await expect(
      listInboxPage(ctxBroken("bot_users"), { filter: ALL, me: "" }),
    ).rejects.toBeInstanceOf(ServerFailure);
    await expect(inboxTotals(ctxBroken("manager_chat_state"), "a")).rejects.toBeInstanceOf(
      ServerFailure,
    );
    await expect(inboxTotals(ctxBroken("zernio_logs"), "a")).rejects.toBeInstanceOf(ServerFailure);
    await expect(getInboxItem(ctxBroken("manager_chat_state"), 1)).rejects.toBeInstanceOf(
      ServerFailure,
    );
  });

  it("запись статуса диалога не прошла — сбой", async () => {
    await expect(
      setInboxMeta(ctxBroken("zernio_logs"), 1, { status: "closed" }, "anna"),
    ).rejects.toBeInstanceOf(ServerFailure);
  });

  it("напоминание о выдаче: заказы не прочитались — сбой", async () => {
    await expect(
      sendFulfillmentReminders(ctxBroken("orders"), async () => undefined),
    ).rejects.toBeInstanceOf(ServerFailure);
  });
});

describe("диалог по ссылке из напоминания", () => {
  it("getInboxItem находит диалог вне первой страницы и отдаёт учёт; нет диалога — null", async () => {
    const ctx = ctxBroken("none");
    const db = (ctx as unknown as { db: ReturnType<typeof fakeDb> }).db;
    db.tables.zernio_logs = [
      {
        bot_id: BOT,
        event_id: inboxEventId(BOT, 1),
        event_type: "inbox",
        status: "closed",
        payload: { telegram_id: 1, assignee: "anna" },
      },
    ];
    expect(await getInboxItem(ctx, 1)).toMatchObject({
      telegram_id: 1,
      status: "closed",
      assignee: "anna",
      tickets: [],
    });
    expect(await getInboxItem(ctx, 404)).toBeNull();
  });
});
