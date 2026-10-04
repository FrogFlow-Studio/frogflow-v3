import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import { cleanLabels, loadSupport, sendSellerMessage } from "@/core/support/support";
import type { TenantContext } from "@/core/tenant/resolve.server";

/** Ч9: статусы, метки и заметка оператора; фильтр и счётчики; заметка недоступна продавцу. */
let db: FakeDb;
vi.mock("@/core/db/client.server", () => ({ serviceDb: () => db }));
vi.mock("@/core/tenant/resolve.server", async (orig) => ({
  ...(await orig<object>()),
  tenantDirectory: async () => [
    { id: "b1", name: "Лавка" },
    { id: "b2", name: "Пекарня" },
  ],
}));

const { supportInbox, supportConversation, setThreadStatus, setThreadLabels, saveThreadNote } =
  await import("./support.server");
const seller = (id: string) => ({ tenant: { id, name: id }, db }) as unknown as TenantContext;
const events = () =>
  (db.tables.bots_events ?? db.tables.bot_events ?? []) as Array<{
    bot_id: string;
    actor: string;
    kind: string;
    payload: Record<string, unknown>;
  }>;

beforeEach(async () => {
  db = fakeDb({
    unique: { platform_threads: [["bot_id"]], platform_thread_notes: [["thread_id"]] },
  });
  await sendSellerMessage(seller("b1"), { body: "вопрос по оплате", authorName: "м" });
});

describe("статус обращения", () => {
  it("смена пишется в журнал клиента: от какого к какому и кто; тот же статус — без записи", async () => {
    expect(await setThreadStatus("b1", "in_progress", "operator:яков")).toEqual({
      status: "in_progress",
      changed: true,
    });
    expect(db.tables.platform_threads![0]!.status).toBe("in_progress");
    expect(events()).toHaveLength(1);
    expect(events()[0]).toMatchObject({
      bot_id: "b1",
      actor: "operator:яков",
      kind: "message",
      payload: { action: "support_status", from: "new", to: "in_progress" },
    });
    expect((await setThreadStatus("b1", "in_progress", "operator:яков")).changed).toBe(false);
    expect(events()).toHaveLength(1);
  });

  it("«решено» убирает обращение из рабочих, но оно остаётся в счётчике и под фильтром", async () => {
    await setThreadStatus("b1", "resolved", "o");
    const open = await supportInbox();
    expect(open!.rows).toHaveLength(0);
    expect(open!.counts).toEqual({ new: 0, in_progress: 0, waiting_seller: 0, resolved: 1 });
    const done = await supportInbox({ status: "resolved" });
    expect(done!.rows.map((r) => r.client)).toEqual(["Лавка"]);
  });

  it("продавец ответил на вопрос оператора — обращение снова «в работе» (прежнее поведение цело)", async () => {
    await setThreadStatus("b1", "waiting_seller", "o");
    await sendSellerMessage(seller("b1"), { body: "вот скрин", authorName: "м" });
    expect(db.tables.platform_threads![0]!.status).toBe("in_progress");
  });

  it("клиент без обращений — понятный отказ, а не падение", async () => {
    await expect(setThreadStatus("b2", "resolved", "o")).rejects.toThrow("нет обращений");
    expect(events()).toHaveLength(0);
  });

  it("два оператора одновременно: оба прошли, счётчики продавца не затёрты", async () => {
    db.tables.platform_threads![0]!.operator_unread = 3;
    await Promise.all([
      setThreadStatus("b1", "in_progress", "a"),
      setThreadLabels("b1", ["оплата"], "b"),
    ]);
    const t = db.tables.platform_threads![0]!;
    expect(t.status).toBe("in_progress");
    expect(t.labels).toEqual(["оплата"]);
    expect(t.operator_unread).toBe(3);
  });
});

describe("метки", () => {
  it("чистятся: пробелы, повторы без учёта регистра, пустые; не больше пяти и 30 знаков", () => {
    expect(cleanLabels(["  оплата ", "Оплата", "", "Instagram"])).toEqual(["оплата", "Instagram"]);
    expect(() => cleanLabels(["a", "b", "c", "d", "e", "f"])).toThrow("не больше 5");
    expect(() => cleanLabels(["я".repeat(31)])).toThrow("длиннее 30");
  });

  it("ставятся, пишутся в журнал и дают фильтр с количеством", async () => {
    await sendSellerMessage(seller("b2"), { body: "не отвечает бот", authorName: "к" });
    await setThreadLabels("b1", ["оплата", "Instagram"], "o");
    await setThreadLabels("b2", ["ошибка", "Instagram"], "o");
    expect(events().find((e) => e.payload.action === "support_labels")?.payload).toMatchObject({
      from: [],
      to: ["оплата", "Instagram"],
    });
    const all = await supportInbox();
    expect(all!.labels).toEqual([
      { label: "Instagram", count: 2 },
      { label: "оплата", count: 1 },
      { label: "ошибка", count: 1 },
    ]);
    const byLabel = await supportInbox({ label: "ошибка" });
    expect(byLabel!.rows.map((r) => r.client)).toEqual(["Пекарня"]);
    // Регистр метки в фильтре не важен.
    expect((await supportInbox({ label: "INSTAGRAM" }))!.rows).toHaveLength(2);
    // Статус и метка вместе.
    await setThreadStatus("b2", "waiting_seller", "o");
    expect(
      (await supportInbox({ status: "waiting_seller", label: "Instagram" }))!.rows,
    ).toHaveLength(1);
    expect((await supportInbox({ status: "new", label: "Instagram" }))!.rows).toHaveLength(1);
  });

  it("то же самое повторно — ни записи, ни события", async () => {
    await setThreadLabels("b1", ["оплата"], "o");
    await setThreadLabels("b1", [" оплата "], "o");
    expect(events().filter((e) => e.payload.action === "support_labels")).toHaveLength(1);
  });
});

describe("заметка оператора", () => {
  it("сохраняется, видна оператору, в журнал идёт длина, а не текст", async () => {
    const r = await saveThreadNote("b1", { note: "Платит Kaspi, ждёт чек", expectedAt: null }, "o");
    const conv = await supportConversation("b1");
    expect(conv!.note).toMatchObject({ text: "Платит Kaspi, ждёт чек", updatedAt: r.updatedAt });
    const ev = events().find((e) => e.payload.action === "support_note")!;
    expect(ev.payload).toMatchObject({ length: 22 });
    expect(JSON.stringify(ev.payload)).not.toContain("Kaspi");
  });

  it("второй оператор с устаревшей версией не затирает чужую заметку", async () => {
    const first = await saveThreadNote("b1", { note: "первая", expectedAt: null }, "a");
    // Версия заметки — время записи: между правками проходит хотя бы миллисекунда.
    await new Promise((r) => setTimeout(r, 5));
    await saveThreadNote("b1", { note: "вторая", expectedAt: first.updatedAt }, "b");
    await expect(
      saveThreadNote("b1", { note: "третья со старой версии", expectedAt: first.updatedAt }, "c"),
    ).rejects.toThrow("уже изменили");
    await expect(
      saveThreadNote("b1", { note: "четвёртая", expectedAt: null }, "d"),
    ).rejects.toThrow("уже изменили");
    expect((await supportConversation("b1"))!.note.text).toBe("вторая");
  });

  it("продавец заметки не получает: ни в его чате, ни в его запросах", async () => {
    await saveThreadNote("b1", { note: "ВНУТРЕННЕЕ-МНЕНИЕ", expectedAt: null }, "o");
    await setThreadLabels("b1", ["ошибка"], "o");
    const view = await loadSupport(seller("b1"));
    expect(JSON.stringify(view)).not.toContain("ВНУТРЕННЕЕ-МНЕНИЕ");
    // Код стороны продавца к таблице заметок не обращается вовсе.
    expect(readFileSync("src/core/support/support.ts", "utf8")).not.toContain(
      "platform_thread_notes",
    );
    expect(readFileSync("src/app/admin/support.functions.ts", "utf8")).not.toContain(
      "platform_thread_notes",
    );
  });

  it("слишком длинная заметка — отказ человеку", async () => {
    await expect(
      saveThreadNote("b1", { note: "я".repeat(4001), expectedAt: null }, "o"),
    ).rejects.toThrow("4000");
  });
});

describe("RLS: заметка закрыта от роли продавца (миграция 19-1)", () => {
  const sql = readFileSync("migrations/19-1-platform-support.sql", "utf8");
  it("права у tenant_bot на таблицу заметок отозваны и не выданы, политик нет", () => {
    expect(sql).toMatch(/REVOKE ALL ON [^;]*platform_thread_notes[^;]* FROM tenant_bot;/);
    expect(sql).not.toMatch(/GRANT [^;]*platform_thread_notes[^;]* TO tenant_bot/);
    expect(sql).toMatch(/ALTER TABLE platform_thread_notes\s+ENABLE ROW LEVEL SECURITY/);
    expect(sql).not.toMatch(/CREATE POLICY \w+\s+ON platform_thread_notes/);
  });
  it("статус и метки продавцу правит только оператор: метки в списке прав продавца нет", () => {
    const grant = /GRANT UPDATE \(([^)]*)\)\s+ON platform_threads TO tenant_bot/.exec(sql)![1]!;
    expect(grant).not.toContain("labels");
  });
});
