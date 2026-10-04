import { beforeEach, describe, expect, it } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import { withBrokenReads } from "../../../tests/broken-db";
import { UserError } from "@/core/i18n/user-error";
import type { TenantContext } from "@/core/tenant/resolve.server";
import {
  cleanBody,
  isMissingTable,
  loadSupport,
  markSellerRead,
  sendSellerMessage,
  supportUnread,
} from "./support";

/** Чат с поддержкой, сторона продавца: отправка, счётчики, гонки, «таблицы нет». */
let db: FakeDb;
const ctxFor = (id: string, d: FakeDb = db) =>
  ({ tenant: { id, name: id }, db: d }) as unknown as TenantContext;

beforeEach(() => {
  // Незакрытое обращение у магазина одно — как уникальный индекс в миграции 19-1.
  db = fakeDb({ unique: { platform_threads: [["bot_id"]] } });
});

describe("текст сообщения", () => {
  it("пустое и слишком длинное отклоняются понятной ошибкой", () => {
    expect(() => cleanBody("  \n ")).toThrow(UserError);
    expect(() => cleanBody("а".repeat(4001))).toThrow(UserError);
    expect(cleanBody(" привет \r\n мир ")).toBe("привет \n мир");
  });
});

describe("отправка продавцом", () => {
  it("первое сообщение заводит обращение, оператору — одно непрочитанное", async () => {
    const r = await sendSellerMessage(ctxFor("b1"), {
      body: "Не приходят заказы",
      authorName: "masha",
    });
    expect(r.message).toMatchObject({ author: "seller", body: "Не приходят заказы", read: false });
    expect(db.tables.platform_threads).toHaveLength(1);
    expect(db.tables.platform_threads![0]).toMatchObject({
      bot_id: "b1",
      status: "new",
      operator_unread: 1,
      seller_unread: 0,
      rev: 1,
    });
    expect(db.tables.platform_messages![0]).toMatchObject({ bot_id: "b1", author: "seller" });
  });

  it("ответ продавца на вопрос оператора возвращает обращение «в работу»", async () => {
    await sendSellerMessage(ctxFor("b1"), { body: "раз", authorName: "m" });
    db.tables.platform_threads![0]!.status = "waiting_seller";
    await sendSellerMessage(ctxFor("b1"), { body: "два", authorName: "m" });
    expect(db.tables.platform_threads![0]).toMatchObject({
      status: "in_progress",
      operator_unread: 2,
    });
  });

  it("два сообщения одновременно: одно обращение, оба в счётчике (гонка)", async () => {
    await Promise.all([
      sendSellerMessage(ctxFor("b1"), { body: "раз", authorName: "m" }),
      sendSellerMessage(ctxFor("b1"), { body: "два", authorName: "m" }),
    ]);
    expect(db.tables.platform_threads).toHaveLength(1);
    expect(db.tables.platform_messages).toHaveLength(2);
    expect(db.tables.platform_threads![0]!.operator_unread).toBe(2);
  });

  it("после «решено» новое сообщение открывает следующее обращение", async () => {
    db = fakeDb(); // без упрощённого «одно обращение на магазин»: тут их два
    db.tables.platform_threads = [
      {
        id: "t-old",
        bot_id: "b1",
        status: "resolved",
        created_at: "2026-10-01T00:00:00Z",
        rev: 3,
        operator_unread: 0,
        seller_unread: 0,
      },
    ];
    const r = await sendSellerMessage(ctxFor("b1"), { body: "снова", authorName: "m" });
    expect(db.tables.platform_threads).toHaveLength(2);
    expect(r.thread.id).not.toBe("t-old");
    expect(r.thread.status).toBe("new");
  });

  it("чужой магазин не видит чужую переписку", async () => {
    await sendSellerMessage(ctxFor("b1"), { body: "секрет b1", authorName: "m" });
    await sendSellerMessage(ctxFor("b2"), { body: "про b2", authorName: "k" });
    const view = await loadSupport(ctxFor("b2"));
    expect(view.available && view.messages.map((m) => m.body)).toEqual(["про b2"]);
  });
});

describe("чтение и «прочитано»", () => {
  it("открыли чат — ответы оператора прочитаны, счётчик гаснет", async () => {
    await sendSellerMessage(ctxFor("b1"), { body: "вопрос", authorName: "m" });
    const t = db.tables.platform_threads![0]!;
    t.seller_unread = 2;
    db.tables.platform_messages!.push({
      id: "m-op",
      bot_id: "b1",
      thread_id: t.id,
      author: "operator",
      body: "ответ",
      created_at: "2099-01-01T00:00:00Z",
      read_at: null,
    });
    expect(await supportUnread(ctxFor("b1"))).toBe(2);
    await markSellerRead(ctxFor("b1"));
    expect(await supportUnread(ctxFor("b1"))).toBe(0);
    expect(db.tables.platform_messages!.find((m) => m.id === "m-op")!.read_at).toBeTruthy();
    // свои сообщения продавец «прочитанными» не делает
    expect(db.tables.platform_messages![0]!.read_at).toBeNull();
  });

  it("больше тысячи сообщений читаются целиком, по порядку", async () => {
    db.tables.platform_messages = Array.from({ length: 2300 }, (_, i) => ({
      id: `m${String(i).padStart(5, "0")}`,
      bot_id: "b1",
      thread_id: "t",
      author: "seller",
      body: String(i),
      created_at: "2026-10-04T00:00:00Z",
      read_at: null,
    }));
    db.maxRows = 1000;
    const view = await loadSupport(ctxFor("b1"));
    expect(view.available && view.messages).toHaveLength(2300);
  });
});

describe("таблиц ещё нет (миграция 19-1 не применена)", () => {
  const missing = () => {
    const err = {
      data: null,
      error: {
        code: "PGRST205",
        message: "Could not find the table 'public.platform_messages' in the schema cache",
      },
    };
    const chain: unknown = new Proxy(
      {},
      {
        get: (_t, k) =>
          k === "then"
            ? (ok: (v: unknown) => unknown) => Promise.resolve(err).then(ok)
            : () => chain,
      },
    );
    return { from: () => chain } as unknown as FakeDb;
  };

  it("раздел выключен: ответ «недоступно», а не падение", async () => {
    expect(await loadSupport(ctxFor("b1", missing()))).toEqual({ available: false });
    expect(await supportUnread(ctxFor("b1", missing()))).toBe(0);
    await expect(markSellerRead(ctxFor("b1", missing()))).resolves.toBeUndefined();
  });

  it("отправка честно говорит «скоро»", async () => {
    await expect(
      sendSellerMessage(ctxFor("b1", missing()), { body: "привет", authorName: "m" }),
    ).rejects.toMatchObject({ key: "err.support.soon" });
  });

  it("распознаёт обе формы ответа базы", () => {
    expect(isMissingTable({ code: "PGRST205" })).toBe(true);
    expect(isMissingTable({ code: "42P01" })).toBe(true);
    expect(isMissingTable({ message: 'relation "platform_threads" does not exist' })).toBe(true);
    expect(isMissingTable({ message: "connection reset" })).toBe(false);
  });
});

describe("сбой чтения — не «нет данных»", () => {
  it("упавшая база не превращается в «раздел выключен» или пустой чат", async () => {
    const broken = withBrokenReads(db, ["platform_messages"]);
    await expect(loadSupport(ctxFor("b1", broken))).rejects.toThrow();
    const broken2 = withBrokenReads(db, ["platform_threads"]);
    await expect(supportUnread(ctxFor("b1", broken2))).rejects.toThrow();
  });
});
