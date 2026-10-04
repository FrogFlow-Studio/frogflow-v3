import { beforeEach, describe, expect, it, vi } from "vitest";
import { setEnvForTests } from "@/config/env";

type Row = { bot_id: string; key: string; value: string };
const store: Row[] = [];

/** Мини-база: поддерживает ровно те запросы, что делает модуль (eq, like по значению, order, range). */
function table() {
  type Op = { kind: "select" | "update" | "insert" | "delete"; payload?: unknown };
  return {
    from: () => {
      let op: Op = { kind: "select" };
      const f: Array<(r: Row) => boolean> = [];
      const q: Record<string, unknown> = {
        select: () => q,
        insert: (v: Row) => {
          store.push({ ...v });
          return Promise.resolve({ error: null });
        },
        update: (v: { value: string }) => {
          op = { kind: "update", payload: v };
          return q;
        },
        delete: () => {
          op = { kind: "delete" };
          return q;
        },
        eq: (c: keyof Row, v: string) => (f.push((r) => r[c] === v), q),
        like: (c: keyof Row, pat: string) => {
          const re = new RegExp(
            `^${pat.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*")}$`,
            "s",
          );
          f.push((r) => re.test(r[c]));
          return q;
        },
        order: () => q,
        range: (a: number, b: number) =>
          Promise.resolve({
            data: store.filter((r) => f.every((x) => x(r))).slice(a, b + 1),
            error: null,
          }),
        maybeSingle: () =>
          Promise.resolve({ data: store.find((r) => f.every((x) => x(r))) ?? null, error: null }),
        then: (res: (v: unknown) => unknown) => {
          const hit = store.filter((r) => f.every((x) => x(r)));
          if (op.kind === "update")
            for (const r of hit) r.value = (op.payload as { value: string }).value;
          if (op.kind === "delete") for (const r of hit) store.splice(store.indexOf(r), 1);
          return Promise.resolve({ data: hit.map((r) => ({ key: r.key })), error: null }).then(res);
        },
      };
      return q;
    },
  };
}

vi.mock("@/core/db/client.server", () => ({ serviceDb: () => table() }));
vi.mock("@/core/tenant/resolve.server", () => ({
  tenantDirectory: async () => [
    { id: "bot-a", name: "Клиент А" },
    { id: "bot-b", name: "Клиент Б" },
  ],
}));

const S = await import("./client-notes.server");

beforeEach(() => {
  store.length = 0;
  setEnvForTests({ APP_TIMEZONE: "Asia/Almaty" });
});

const NOW = new Date("2026-10-10T08:00:00Z");

describe("задачи оператора по клиенту", () => {
  it("задача на сегодня видна на главной, будущая и чужой срок — нет, просроченная помечена", async () => {
    await S.addClientTask("bot-a", "позвонить", "2026-10-10", NOW);
    await S.addClientTask("bot-b", "выставить счёт", "2026-10-09", NOW);
    await S.addClientTask("bot-a", "напомнить потом", "2026-10-20", NOW);
    const { today, tasks } = await S.todayTasks(NOW);
    expect(today).toBe("2026-10-10");
    expect(tasks.map((t) => [t.clientName, t.text, t.overdue])).toEqual([
      ["Клиент Б", "выставить счёт", true],
      ["Клиент А", "позвонить", false],
    ]);
  });

  it("закрыть можно один раз: вторая попытка ничего не пишет, задача пропадает с главной", async () => {
    await S.addClientTask("bot-a", "позвонить", "2026-10-10", NOW);
    const id = (await S.listClientNotes("bot-a")).tasks[0]!.id;
    expect(await S.closeClientTask("bot-a", id, NOW)).toEqual({ closed: true });
    const closedAt = store[0]!.value;
    expect(await S.closeClientTask("bot-a", id, new Date("2026-10-11T00:00:00Z"))).toEqual({
      closed: false,
    });
    expect(store[0]!.value).toBe(closedAt);
    expect((await S.todayTasks(NOW)).tasks).toEqual([]);
    expect((await S.listClientNotes("bot-a")).tasks[0]).toMatchObject({ status: "done" });
  });

  it("гонка: два закрытия подряд без ожидания — выигрывает одно", async () => {
    await S.addClientTask("bot-a", "позвонить", "2026-10-10", NOW);
    const id = (await S.listClientNotes("bot-a")).tasks[0]!.id;
    const r = await Promise.all([
      S.closeClientTask("bot-a", id, NOW),
      S.closeClientTask("bot-a", id, NOW),
    ]);
    expect(r.filter((x) => x.closed)).toHaveLength(1);
  });

  it("текст задачи, похожий на метку статуса, не открывает закрытую задачу", async () => {
    await S.addClientTask("bot-a", '"status":"open"', "2026-10-10", NOW);
    const id = (await S.listClientNotes("bot-a")).tasks[0]!.id;
    await S.closeClientTask("bot-a", id, NOW);
    expect((await S.closeClientTask("bot-a", id, NOW)).closed).toBe(false);
  });

  it("плохой срок и пустой текст отклоняются", async () => {
    await expect(S.addClientTask("bot-a", "x", "10.10.2026", NOW)).rejects.toThrow();
    await expect(S.addClientTask("bot-a", "x", "2026-02-30", NOW)).rejects.toThrow();
    await expect(S.addClientTask("bot-a", "  ", "2026-10-10", NOW)).rejects.toThrow();
  });
});

describe("заметки по клиенту", () => {
  it("видны только у своего клиента, новые выше, удаляются по ключу", async () => {
    await S.addClientNote("bot-a", "первая", new Date("2026-10-01T00:00:00Z"));
    await S.addClientNote("bot-a", "вторая", new Date("2026-10-02T00:00:00Z"));
    await S.addClientNote("bot-b", "чужая", NOW);
    const { notes } = await S.listClientNotes("bot-a");
    expect(notes.map((n) => n.text)).toEqual(["вторая", "первая"]);
    await S.deleteClientNote("bot-a", notes[0]!.id);
    expect((await S.listClientNotes("bot-a")).notes.map((n) => n.text)).toEqual(["первая"]);
  });
});
