import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import { sendSellerMessage } from "@/core/support/support";
import { withBrokenReads } from "../../../tests/broken-db";
import type { TenantContext } from "@/core/tenant/resolve.server";

/** Поддержка, сторона оператора: входящие, ответ, первый ответ, «решено» → новое обращение. */
let db: FakeDb;
vi.mock("@/core/db/client.server", () => ({ serviceDb: () => db }));
vi.mock("@/core/tenant/resolve.server", async (orig) => ({
  ...(await orig<object>()),
  tenantDirectory: async () => [
    { id: "b1", name: "Лавка" },
    { id: "b2", name: "Пекарня" },
  ],
}));

const { supportInbox, supportConversation, operatorReply, typicalResponseHours } =
  await import("./support.server");
const seller = (id: string) => ({ tenant: { id, name: id }, db }) as unknown as TenantContext;

beforeEach(() => {
  db = fakeDb({ unique: { platform_threads: [["bot_id"]] } });
});

describe("входящие поддержки", () => {
  it("непрочитанные сверху, потом давние; решённые только в счётчике", async () => {
    await sendSellerMessage(seller("b1"), { body: "а", authorName: "m" });
    await sendSellerMessage(seller("b2"), { body: "б", authorName: "k" });
    // b1 уже читали, b2 — нет
    db.tables.platform_threads!.find((t) => t.bot_id === "b1")!.operator_unread = 0;
    db.tables.platform_threads!.push({
      id: "t-done",
      bot_id: "b3",
      status: "resolved",
      last_message_at: "2026-10-01T00:00:00Z",
      operator_unread: 0,
    });
    const inbox = await supportInbox();
    expect(inbox!.rows.map((r) => r.client)).toEqual(["Пекарня", "Лавка"]);
    expect(inbox!.resolved).toBe(1);
  });

  it("таблиц нет — null, а не ошибка", async () => {
    const chain: unknown = new Proxy(
      {},
      {
        get: (_t, k) =>
          k === "then"
            ? (ok: (v: unknown) => unknown) =>
                Promise.resolve({
                  data: null,
                  error: { code: "PGRST205", message: "Could not find the table" },
                }).then(ok)
            : () => chain,
      },
    );
    db = { from: () => chain } as unknown as FakeDb;
    expect(await supportInbox()).toBeNull();
    expect(await supportConversation("b1")).toBeNull();
  });
});

describe("ответ оператора", () => {
  it("статус «ждёт продавца», продавцу — непрочитанное, первый ответ запомнен один раз", async () => {
    await sendSellerMessage(seller("b1"), { body: "вопрос", authorName: "m" });
    const r1 = await operatorReply("b1", { body: "Смотрю", operator: "yakov" });
    expect(r1.thread).toMatchObject({
      status: "waiting_seller",
      seller_unread: 1,
      operator_unread: 0,
    });
    const first = r1.thread.first_response_at;
    expect(first).toBeTruthy();
    const r2 = await operatorReply("b1", { body: "Готово", operator: "yakov" });
    expect(r2.thread.seller_unread).toBe(2);
    expect(r2.thread.first_response_at).toBe(first);
  });

  it("ответ в чужой или несуществующий магазин не пишется", async () => {
    await expect(operatorReply("nope", { body: "эй", operator: "y" })).rejects.toThrow();
    expect(db.tables.platform_messages ?? []).toHaveLength(0);
  });

  it("ответ по закрытому обращению заводит открытое", async () => {
    db = fakeDb();
    db.tables.platform_threads = [
      {
        id: "t-old",
        bot_id: "b1",
        status: "resolved",
        created_at: "2026-10-01T00:00:00Z",
        rev: 2,
        operator_unread: 0,
        seller_unread: 0,
        first_response_at: null,
      },
    ];
    const r = await operatorReply("b1", { body: "Напомню про вчерашнее", operator: "y" });
    expect(r.thread.id).not.toBe("t-old");
    expect(r.thread.status).toBe("waiting_seller");
  });

  it("открыть переписку — прочитать: счётчик оператора гаснет, сообщения отмечены", async () => {
    await sendSellerMessage(seller("b1"), { body: "вопрос", authorName: "m" });
    const conv = await supportConversation("b1");
    expect(conv).toMatchObject({ client: "Лавка", status: "new" });
    expect(db.tables.platform_threads![0]!.operator_unread).toBe(0);
    expect(db.tables.platform_messages![0]!.read_at).toBeTruthy();
  });

  it("два ответа подряд — оба в счётчике продавца (гонка)", async () => {
    await sendSellerMessage(seller("b1"), { body: "вопрос", authorName: "m" });
    await Promise.all([
      operatorReply("b1", { body: "раз", operator: "y" }),
      operatorReply("b1", { body: "два", operator: "y" }),
    ]);
    expect(db.tables.platform_threads![0]!.seller_unread).toBe(2);
  });
});

describe("скорость ответа", () => {
  // Дата зашита: понедельник 5 октября 2026, Алматы = UTC+5.
  const at = (hm: string) => `2026-10-05T${hm}:00+05:00`;
  const NOW = new Date(at("14:00"));
  const thread = (over: Record<string, unknown>) => ({
    id: `t-${Math.random()}`,
    status: "new",
    labels: [],
    last_message_at: at("11:00"),
    last_operator_message_at: null,
    seller_unread: 0,
    operator_unread: 1,
    rev: 0,
    ...over,
  });

  it("в списке — «ответить до» по тарифу в рабочих часах и просрочка; среднее за неделю", async () => {
    db.tables.platform_threads = [
      thread({
        bot_id: "b1",
        created_at: at("11:00"),
        last_seller_message_at: at("11:00"),
        first_response_at: null,
      }),
      // Уже отвечено за 60 рабочих минут — в среднее за неделю.
      thread({
        bot_id: "b2",
        status: "waiting_seller",
        created_at: at("10:00"),
        last_seller_message_at: at("10:00"),
        last_operator_message_at: at("11:00"),
        first_response_at: at("11:00"),
      }),
    ];
    const inbox = (await supportInbox({}, NOW))!;
    const b1 = inbox.rows.find((r) => r.botId === "b1")!;
    // Тарифа в справочнике нет — цель как у Basic: 8 рабочих часов от 11:00 = до 19:00.
    expect(b1.reply).toEqual({ due: new Date(at("19:00")).toISOString(), overdue: false });
    expect(inbox.rows.find((r) => r.botId === "b2")!.reply).toBeNull();
    expect(inbox.week).toEqual({ count: 1, avgMinutes: 60 });
  });

  it("«обычно отвечаем»: мало ответов — null; пять и больше — часы по факту; прочитать не вышло — null", async () => {
    expect(await typicalResponseHours(NOW)).toBeNull();
    db.tables.platform_threads = [30, 60, 90, 120, 100].map((m, i) =>
      thread({
        id: `s${i}`,
        bot_id: "b1",
        status: "resolved",
        created_at: at("10:00"),
        first_response_at: new Date(new Date(at("10:00")).getTime() + m * 60_000).toISOString(),
      }),
    );
    expect(await typicalResponseHours(NOW)).toBe(2);
    db = withBrokenReads(db, ["platform_threads"]);
    expect(await typicalResponseHours(NOW)).toBeNull();
  });
});
