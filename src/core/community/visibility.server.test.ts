import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";

/**
 * П5 (партия 20): общение авторов и модерация. Видимость (скрытое, заблокированные,
 * клиент прежней платформы) и постраничность без потерь. Спам-лимиты обходятся
 * прямой записью строк: здесь проверяется чтение.
 */
const db = fakeDb({
  unique: {
    community_reports: [
      ["bot_id", "thread_id"],
      ["bot_id", "post_id"],
    ],
  },
});
let tenants: Array<Record<string, unknown>> = [];
vi.mock("@/core/db/client.server", () => ({ serviceDb: () => db }));
vi.mock("@/core/tenant/resolve.server", () => ({ tenantDirectory: async () => tenants }));

const srv = await import("./threads.server");
const mod = await import("./moderation.server");

const author = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id,
  name: `Магазин ${name}`,
  settings: { served_by: "v2", community: { enabled: true, name }, ...extra },
});
const ctx = (id: string) =>
  ({ tenant: tenants.find((t) => t.id === id) }) as unknown as TenantContext;

const THREAD = "t1";
function seedThread(botId = "a") {
  db.tables.community_threads!.push({
    id: THREAD,
    bot_id: botId,
    section: "questions",
    topic: null,
    title: "Тема",
    body: "Текст",
    posts_count: 0,
    hidden: false,
    last_post_at: "2026-10-01T00:00:00Z",
    created_at: "2026-10-01T00:00:00Z",
  });
}
function seedPosts(n: number, botId: string, from = 0) {
  for (let i = from; i < from + n; i++)
    db.tables.community_posts!.push({
      id: `p${String(i).padStart(3, "0")}`,
      thread_id: THREAD,
      bot_id: botId,
      body: `Ответ ${i}`,
      hidden: false,
      created_at: new Date(Date.UTC(2026, 9, 1, 0, 0, i)).toISOString(),
    });
}
const bodies = (r: { posts: Array<{ body: string }> }) => r.posts.map((p) => p.body);

beforeEach(() => {
  db.tables.community_threads = [];
  db.tables.community_posts = [];
  db.tables.community_reports = [];
  tenants = [author("a", "Аня"), author("b", "Боря"), author("d", "Даша")];
});

describe("видимость: клиент прежней платформы не участвует", () => {
  it("не читает, не пишет, а его темы и ответы остальным не видны", async () => {
    tenants.push({
      id: "old",
      name: "Старый",
      settings: { community: { enabled: true, name: "Старый" } },
    });
    await expect(srv.listThreads(ctx("old"), { section: "questions" })).rejects.toThrow(
      "Сначала включите",
    );
    await expect(
      srv.createThread(ctx("old"), { section: "questions", title: "Тема", body: "x" }),
    ).rejects.toThrow("Сначала включите");
    seedThread("old");
    expect((await srv.listThreads(ctx("b"), { section: "questions" })).threads).toEqual([]);
    await expect(srv.getThread(ctx("b"), THREAD)).rejects.toThrow("нет или она скрыта");
    // В теме нашего автора ответ клиента прежней платформы не показывается.
    db.tables.community_threads![0]!.bot_id = "a";
    seedPosts(1, "old");
    seedPosts(1, "b", 1);
    expect(bodies(await srv.getThread(ctx("b"), THREAD))).toEqual(["Ответ 1"]);
  });
});

describe("видимость: скрытое и заблокированные", () => {
  it("заблокированный автор: ответы пропадают, скрытый оператором — виден без имени, остальные на месте", async () => {
    seedThread("a");
    seedPosts(1, "b", 0);
    seedPosts(1, "d", 1);
    seedPosts(1, "a", 2);
    tenants[1] = author("b", "Боря", { community_mod: { status: "blocked" } });
    tenants[2] = author("d", "Даша", { community_mod: { status: "hidden" } });
    const r = await srv.getThread(ctx("a"), THREAD);
    expect(bodies(r)).toEqual(["Ответ 1", "Ответ 2"]);
    expect(r.posts[0]).toMatchObject({ author: null, authorSlug: null });
    expect(r.posts[1]).toMatchObject({ author: "Аня", mine: true });
  });

  it("оператор скрыл ответ: исчез у всех, счётчик уменьшился, возврат оживляет", async () => {
    seedThread("a");
    await srv.createPost(ctx("b"), THREAD, "спам");
    await srv.createPost(ctx("d"), THREAD, "нормальный");
    const post = db.tables.community_posts!.find((p) => p.body === "спам")!;
    await srv.reportContent(ctx("a"), { threadId: THREAD, postId: post.id as string });
    const [rep] = (await mod.listOpenReports()).reports;
    await mod.resolveReport(rep!.id, "hide");
    for (const id of ["a", "b", "d"])
      expect(bodies(await srv.getThread(ctx(id), THREAD))).toEqual(["нормальный"]);
    expect(db.tables.community_threads![0]!.posts_count).toBe(1);
    await mod.resolveReport(rep!.id, "restore");
    expect(bodies(await srv.getThread(ctx("d"), THREAD))).toEqual(["спам", "нормальный"]);
    expect(db.tables.community_threads![0]!.posts_count).toBe(2);
  });

  it("заблокированного автора нет и в списке тем, и по прямой ссылке", async () => {
    seedThread("a");
    tenants[0] = author("a", "Аня", { community_mod: { status: "blocked" } });
    expect((await srv.listThreads(ctx("b"), { section: "questions" })).threads).toEqual([]);
    await expect(srv.getThread(ctx("b"), THREAD)).rejects.toThrow("нет или она скрыта");
  });
});

describe("страницы без потерь", () => {
  it("ответы: 120 штук идут 50 + 50 + 20, повторов и дыр нет", async () => {
    seedThread("a");
    seedPosts(120, "b");
    const seen: string[] = [];
    let next: number | null = 0;
    const sizes: number[] = [];
    while (next !== null) {
      const page = await srv.getThread(ctx("a"), THREAD, next);
      sizes.push(page.posts.length);
      seen.push(...bodies(page));
      next = page.next;
    }
    expect(sizes).toEqual([50, 50, 20]);
    expect(new Set(seen).size).toBe(120);
    expect(seen).toEqual(Array.from({ length: 120 }, (_, i) => `Ответ ${i}`));
  });

  it("страница, где много ответов скрыто или заблокировано, не обрывает чтение: следующая страница по смещению", async () => {
    seedThread("a");
    seedPosts(50, "b"); // первая страница целиком от заблокированного
    seedPosts(5, "d", 50);
    tenants[1] = author("b", "Боря", { community_mod: { status: "blocked" } });
    const p1 = await srv.getThread(ctx("a"), THREAD);
    expect(p1.posts).toEqual([]);
    expect(p1.next).toBe(50);
    const p2 = await srv.getThread(ctx("a"), THREAD, p1.next!);
    expect(bodies(p2)).toEqual(["Ответ 50", "Ответ 51", "Ответ 52", "Ответ 53", "Ответ 54"]);
    expect(p2.next).toBeNull();
  });

  it("жалобы оператора: 45 открытых идут 20 + 20 + 5, `total` — все открытые", async () => {
    seedThread("a");
    for (let i = 0; i < 45; i++)
      db.tables.community_reports!.push({
        id: `r${String(i).padStart(3, "0")}`,
        bot_id: "b",
        thread_id: THREAD,
        post_id: null,
        status: "open",
        reason: null,
        created_at: new Date(Date.UTC(2026, 9, 2, 0, 0, i)).toISOString(),
      });
    const sizes: number[] = [];
    const ids: string[] = [];
    let next: number | null = 0;
    let total = 0;
    while (next !== null) {
      const page = await mod.listOpenReports(next);
      sizes.push(page.reports.length);
      ids.push(...page.reports.map((r) => r.id));
      total = page.total;
      next = page.next;
    }
    expect(sizes).toEqual([20, 20, 5]);
    expect(total).toBe(45);
    expect(new Set(ids).size).toBe(45);
  });
});
