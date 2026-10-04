import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";

const db = fakeDb();
let tenants: Array<Record<string, unknown>> = [];
const patched: Array<[string, Record<string, unknown>]> = [];
vi.mock("@/core/db/client.server", () => ({ serviceDb: () => db }));
vi.mock("@/core/tenant/resolve.server", () => ({
  tenantDirectory: async () => tenants,
  patchTenantSettings: async (id: string, p: Record<string, unknown>) => void patched.push([id, p]),
}));

const srv = await import("./dm.server");

const author = (id: string, name: string, community: object = {}, extra: object = {}) => ({
  id,
  name: `Магазин ${name}`,
  settings: { served_by: "v2", community: { enabled: true, name, ...community }, ...extra },
});
const ctx = (id: string) =>
  ({ tenant: tenants.find((t) => t.id === id) }) as unknown as TenantContext;

beforeEach(() => {
  db.tables.community_dm = [];
  patched.length = 0;
  tenants = [
    author("a", "Аня"),
    author("b", "Боря"),
    { id: "c", name: "Выкл", settings: { served_by: "v2" } },
  ];
});

describe("личные сообщения: отправка", () => {
  it("несогласный не пишет и не читает", async () => {
    await expect(srv.sendDm(ctx("c"), "a", "привет")).rejects.toThrow("Сначала включите");
    await expect(srv.inbox(ctx("c"))).rejects.toThrow("Сначала включите");
    expect(db.tables.community_dm).toHaveLength(0);
  });

  it("пишет согласному; адресату, не вошедшему в сообщество, — нельзя", async () => {
    const r = await srv.sendDm(ctx("a"), "b", "  Привет!  ");
    expect(r.to.id).toBe("b");
    expect(db.tables.community_dm![0]).toMatchObject({
      from_bot_id: "a",
      to_bot_id: "b",
      body: "Привет!",
    });
    await expect(srv.sendDm(ctx("a"), "c", "привет")).rejects.toThrow("сейчас нельзя написать");
    await expect(srv.sendDm(ctx("a"), "zzz", "привет")).rejects.toThrow("сейчас нельзя написать");
    await expect(srv.sendDm(ctx("a"), "b", "   ")).rejects.toThrow("Напишите");
  });

  it("заблокированный адресатом не пишет, остальные пишут", async () => {
    tenants[1] = author("b", "Боря", { dm_blocked: ["a"] });
    await expect(srv.sendDm(ctx("a"), "b", "привет")).rejects.toThrow("сейчас нельзя написать");
    tenants.push(author("d", "Даша"));
    await srv.sendDm(ctx("d"), "b", "привет");
    expect(db.tables.community_dm).toHaveLength(1);
  });

  it("адресат запретил личные — об этом честно говорится", async () => {
    tenants[1] = author("b", "Боря", { dm_off: true });
    await expect(srv.sendDm(ctx("a"), "b", "привет")).rejects.toThrow("не принимает личные");
  });

  it("заблокированный оператором автор не пишет", async () => {
    tenants[0] = author("a", "Аня", {}, { community_mod: { status: "blocked" } });
    await expect(srv.sendDm(ctx("a"), "b", "привет")).rejects.toThrow("Сначала включите");
  });

  it("лимиты: 5 подряд одному автору, 20 всего за час", async () => {
    for (let i = 0; i < 5; i++) await srv.sendDm(ctx("a"), "b", `m${i}`);
    await expect(srv.sendDm(ctx("a"), "b", "ещё")).rejects.toThrow("несколько раз подряд");
    tenants.push(...Array.from({ length: 5 }, (_, i) => author(`x${i}`, `X${i}`)));
    for (let i = 0; i < 5; i++)
      for (let j = 0; j < 3; j++) await srv.sendDm(ctx("a"), `x${i}`, `m${j}`);
    await expect(srv.sendDm(ctx("a"), "x0", "ещё")).rejects.toThrow("Слишком много");
  });
});

describe("личные сообщения: одно уведомление на сообщение", () => {
  it("два параллельных вызова — выигрывает один", async () => {
    const { id } = await srv.sendDm(ctx("a"), "b", "привет");
    const r = await Promise.all([srv.claimDmNotice(id), srv.claimDmNotice(id)]);
    expect(r.filter(Boolean)).toHaveLength(1);
    expect(await srv.claimDmNotice(id)).toBe(false);
  });
});

describe("личные сообщения: переписка и прочитанное", () => {
  it("список переписок, непрочитанные, открытие помечает прочитанным", async () => {
    await srv.sendDm(ctx("a"), "b", "Привет, Боря");
    await srv.sendDm(ctx("a"), "b", "Ты тут?");
    await srv.sendDm(ctx("b"), "a", "Да");
    const mine = await srv.inbox(ctx("b"));
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({
      with: "a",
      name: "Аня",
      unread: 2,
      canReply: true,
      lastFromMe: true,
    });
    expect(await srv.unreadCount(ctx("b"))).toBe(2);
    const th = await srv.dmThread(ctx("b"), "a");
    expect(th.messages.map((m) => m.body)).toEqual(["Привет, Боря", "Ты тут?", "Да"]);
    expect(th.messages.map((m) => m.mine)).toEqual([false, false, true]);
    expect(await srv.unreadCount(ctx("b"))).toBe(0);
    // Чужая переписка третьему не видна.
    tenants.push(author("d", "Даша"));
    expect(await srv.inbox(ctx("d"))).toEqual([]);
    expect((await srv.dmThread(ctx("d"), "a")).messages).toEqual([]);
  });

  it("собеседник выключил сообщество — переписка остаётся, имя скрыто, ответить нельзя", async () => {
    await srv.sendDm(ctx("a"), "b", "Привет");
    tenants[1] = {
      id: "b",
      name: "Б",
      settings: { served_by: "v2", community: { enabled: false } },
    };
    const [c] = await srv.inbox(ctx("a"));
    expect(c).toMatchObject({ name: null, canReply: false });
    expect((await srv.dmThread(ctx("a"), "b")).canReply).toBe(false);
  });
});

describe("личные сообщения: страницы", () => {
  it("65 сообщений идут 30 + 30 + 5 от свежих к старым, ничего не теряется и не повторяется", async () => {
    for (let i = 0; i < 65; i++)
      db.tables.community_dm!.push({
        id: `m${String(i).padStart(3, "0")}`,
        from_bot_id: i % 2 ? "a" : "b",
        to_bot_id: i % 2 ? "b" : "a",
        body: `с${i}`,
        read_at: null,
        created_at: new Date(Date.UTC(2026, 9, 1, 0, 0, i)).toISOString(),
      });
    const seen: string[] = [];
    const sizes: number[] = [];
    let next: number | null = 0;
    while (next !== null) {
      const page = await srv.dmThread(ctx("a"), "b", next);
      sizes.push(page.messages.length);
      seen.unshift(...page.messages.map((m) => m.body));
      next = page.next;
    }
    expect(sizes).toEqual([30, 30, 5]);
    expect(seen).toEqual(Array.from({ length: 65 }, (_, i) => `с${i}`));
  });
});

describe("личные сообщения: приём и запреты", () => {
  it("«не принимать» и запрет автору пишутся в settings.community, список без повторов", async () => {
    await srv.setDmOff(ctx("a"), true);
    expect(patched[0]).toEqual(["a", { community: { dm_off: true } }]);
    tenants[0] = author("a", "Аня", { dm_blocked: ["b"] });
    await srv.setDmBlocked(ctx("a"), "b", true);
    await srv.setDmBlocked(ctx("a"), "d", true);
    await srv.setDmBlocked(ctx("a"), "b", false);
    expect(
      patched.slice(1).map((p) => (p[1].community as { dm_blocked: string[] }).dm_blocked),
    ).toEqual([["b"], ["b", "d"], []]);
    await srv.setDmBlocked(ctx("a"), "a", true);
    expect(patched).toHaveLength(4);
  });

  it("список авторов: без себя, скрытых, выключенных и заблокированных", async () => {
    tenants.push(
      author("h", "Скрыт", {}, { community_mod: { status: "hidden" } }),
      author("k", "Блок", {}, { community_mod: { status: "blocked" } }),
    );
    expect((await srv.listAuthors(ctx("a"))).map((x) => x.id)).toEqual(["b"]);
  });
});

describe("личные сообщения: таблицы ещё нет", () => {
  it("кнопки нет, ответ «скоро»", async () => {
    const { orSoon } = await import("./not-ready");
    const real = db.from;
    const miss = { code: "PGRST205", message: "Could not find the table 'public.community_dm'" };
    const chain: Record<string, unknown> = new Proxy(
      {},
      {
        get: (_t, k) =>
          k === "then"
            ? (res: (v: unknown) => void) => res({ data: null, error: miss, count: null })
            : () => chain,
      },
    );
    db.from = (() => chain) as never;
    try {
      expect(await orSoon(async () => ({ conversations: await srv.inbox(ctx("a")) }))).toEqual({
        soon: true,
      });
      expect(await orSoon(async () => ({ unread: await srv.unreadCount(ctx("a")) }))).toEqual({
        soon: true,
      });
      await expect(srv.sendDm(ctx("a"), "b", "привет")).rejects.toThrow("not installed");
    } finally {
      db.from = real;
    }
  });
});
