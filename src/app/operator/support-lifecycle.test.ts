import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import { sendSellerMessage } from "@/core/support/support";
import { QUICK_REPLIES, quickReplyText } from "@/core/support/quick-replies";
import type { TenantContext } from "@/core/tenant/resolve.server";

/**
 * П2 (партия 20): обращение от создания до закрытия одним сквозным путём.
 * Статусы (Ч9), метки (Ч9), скорость ответа (Ч11) и быстрые ответы (Ч4) живут
 * вместе: смена статуса не сбрасывает таймер, метки не теряются, быстрый ответ
 * ложится на языке автора.
 */
let db: FakeDb;
vi.mock("@/core/db/client.server", () => ({ serviceDb: () => db }));
vi.mock("@/core/tenant/resolve.server", async (orig) => ({
  ...(await orig<object>()),
  tenantDirectory: async () => [
    { id: "q1", name: "Дүкен", plan: "flowers.business", settings: { default_locale: "kk" } },
  ],
}));

const { supportInbox, supportConversation, operatorReply, setThreadStatus, setThreadLabels } =
  await import("./support.server");
const seller = () => ({ tenant: { id: "q1", name: "Дүкен" }, db }) as unknown as TenantContext;
const thread = () => db.tables.platform_threads![0]!;

beforeEach(() => {
  db = fakeDb({ unique: { platform_threads: [["bot_id"]] } });
});

describe("обращение от создания до закрытия", () => {
  it("статус и метки не сбрасывают таймер ответа и друг друга; быстрый ответ — на языке магазина", async () => {
    // 1. Продавец пишет: новое обращение, ждёт оператора.
    await sendSellerMessage(seller(), { body: "не работает оплата", authorName: "Айгүл" });
    expect(thread().status).toBe("new");
    const created = thread().created_at;

    // 2. Оператор открывает переписку и берёт быстрый ответ на языке магазина.
    const view = await supportConversation("q1");
    expect(view!.shop.locale).toBe("kk");
    const quick = QUICK_REPLIES.find((q) => q.id === "taken")!;
    const text = quickReplyText(quick, view!.shop.locale, {
      shop: view!.shop.name,
      plan: view!.shop.planTitle,
    });
    expect(text).toBe(quick.text.kk.replace("{shop}", "Дүкен"));
    expect(text).not.toMatch(/[{}]/);

    // 3. Отвечает: статус «ждём продавца», первый ответ запомнен.
    const { message } = await operatorReply("q1", { body: text, operator: "яков" });
    expect(message.body).toBe(text);
    expect(thread().status).toBe("waiting_seller");
    const firstResponse = thread().first_response_at;
    expect(firstResponse).toBeTruthy();
    expect(thread().seller_unread).toBe(1);

    // 4. Метки и ручной статус: таймер и счётчики на месте.
    await setThreadLabels("q1", ["оплата", "срочно"], "яков");
    await setThreadStatus("q1", "in_progress", "яков");
    expect(thread().first_response_at).toBe(firstResponse);
    expect(thread().created_at).toBe(created);
    expect(thread().labels).toEqual(["оплата", "срочно"]);
    expect(thread().seller_unread).toBe(1);

    // 5. Второй ответ оператора не переписывает «первый ответ».
    await operatorReply("q1", { body: "Проверили, исправили.", operator: "яков" });
    expect(thread().first_response_at).toBe(firstResponse);
    expect(thread().labels).toEqual(["оплата", "срочно"]);

    // 6. Смена статуса не стирает метки, смена меток — статус.
    await setThreadStatus("q1", "resolved", "яков");
    expect(thread().labels).toEqual(["оплата", "срочно"]);
    await setThreadLabels("q1", ["оплата"], "яков");
    expect(thread().status).toBe("resolved");
    expect(thread().first_response_at).toBe(firstResponse);

    // 7. Решённое ушло из рабочих входящих, но видно под фильтром.
    expect((await supportInbox())!.rows).toHaveLength(0);
    const done = await supportInbox({ status: "resolved", label: "оплата" });
    expect(done!.rows.map((r) => r.botId)).toEqual(["q1"]);
  });
});
