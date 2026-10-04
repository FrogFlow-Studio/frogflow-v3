import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";

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

beforeEach(() => {
  db.tables.community_threads = [];
  db.tables.community_posts = [];
  db.tables.community_reports = [];
  tenants = [
    author("a", "Аня"),
    author("b", "Боря"),
    { id: "c", name: "Выкл", settings: { served_by: "v2" } },
  ];
});

describe("сообщество: согласие", () => {
  it("несогласный автор не читает и не пишет", async () => {
    await expect(srv.listThreads(ctx("c"), { section: "questions" })).rejects.toThrow(
      "Сначала включите",
    );
    await expect(
      srv.createThread(ctx("c"), { section: "questions", title: "Вопрос", body: "Текст" }),
    ).rejects.toThrow("Сначала включите");
    expect(db.tables.community_threads).toHaveLength(0);
  });

  it("заблокированный оператором не читает и не пишет", async () => {
    tenants[0] = author("a", "Аня", { community_mod: { status: "blocked" } });
    await expect(srv.listThreads(ctx("a"), { section: "questions" })).rejects.toThrow(
      "Сначала включите",
    );
  });

  it("тема появляется у других; свои помечены, чужое имя показано", async () => {
    const { id } = await srv.createThread(ctx("a"), {
      section: "questions",
      title: "Где печатать открытки?",
      body: "Ищу типографию",
    });
    const mine = await srv.listThreads(ctx("a"), { section: "questions" });
    expect(mine.threads[0]).toMatchObject({ id, mine: true, author: "Аня" });
    const theirs = await srv.listThreads(ctx("b"), { section: "questions" });
    expect(theirs.threads[0]).toMatchObject({ id, mine: false, author: "Аня" });
    expect((await srv.listThreads(ctx("b"), { section: "experience" })).threads).toEqual([]);
  });
});

describe("сообщество: скрытое и чужие тексты", () => {
  it("скрытая тема не видна ни в списке, ни по ссылке", async () => {
    const { id } = await srv.createThread(ctx("a"), {
      section: "questions",
      title: "Тема",
      body: "Текст",
    });
    db.tables.community_threads![0]!.hidden = true;
    expect((await srv.listThreads(ctx("b"), { section: "questions" })).threads).toEqual([]);
    await expect(srv.getThread(ctx("b"), id)).rejects.toThrow("нет или она скрыта");
  });

  it("скрытый ответ не виден, тексты автора, снявшего согласие или заблокированного, пропадают", async () => {
    const { id } = await srv.createThread(ctx("a"), {
      section: "questions",
      title: "Тема",
      body: "Текст",
    });
    await srv.createPost(ctx("b"), id, "Ответ Бори");
    await srv.createPost(ctx("a"), id, "Ответ Ани");
    expect((await srv.getThread(ctx("a"), id)).posts.map((p) => p.body)).toEqual([
      "Ответ Бори",
      "Ответ Ани",
    ]);
    db.tables.community_posts![0]!.hidden = true;
    expect((await srv.getThread(ctx("a"), id)).posts.map((p) => p.body)).toEqual(["Ответ Ани"]);
    // Боря снял согласие: его тексты исчезают. Аня заблокирована: её тема исчезает у всех.
    tenants[1] = {
      id: "b",
      name: "Б",
      settings: { served_by: "v2", community: { enabled: false, name: "Боря" } },
    };
    tenants[0] = author("a", "Аня", { community_mod: { status: "blocked" } });
    tenants.push(author("d", "Даша"));
    await expect(srv.getThread(ctx("d"), id)).rejects.toThrow("нет или она скрыта");
    expect((await srv.listThreads(ctx("d"), { section: "questions" })).threads).toEqual([]);
  });

  it("скрытый оператором автор: текст виден без имени", async () => {
    await srv.createThread(ctx("a"), { section: "questions", title: "Тема", body: "Текст" });
    tenants[0] = author("a", "Аня", { community_mod: { status: "hidden" } });
    const r = await srv.listThreads(ctx("b"), { section: "questions" });
    expect(r.threads[0]).toMatchObject({ author: null });
  });

  it("поиск находит по заголовку и тексту, спецсимволы не ломают запрос", async () => {
    await srv.createThread(ctx("a"), {
      section: "experience",
      title: "Упаковка заказов",
      body: "крафт",
    });
    await srv.createThread(ctx("a"), { section: "experience", title: "Фото", body: "свет у окна" });
    const find = async (q: string) =>
      (await srv.listThreads(ctx("b"), { section: "experience", search: q })).threads.map(
        (t) => t.title,
      );
    expect(await find("упаковка")).toEqual(["Упаковка заказов"]);
    expect(await find("окна")).toEqual(["Фото"]);
    expect(await find("50%,(а)_")).toEqual([]);
  });

  it("подраздел «Ищу / предлагаю» фильтрует по теме", async () => {
    await srv.createThread(ctx("a"), {
      section: "offers",
      topic: "photo",
      title: "Фотограф",
      body: "ищу",
    });
    await srv.createThread(ctx("a"), {
      section: "offers",
      topic: "delivery",
      title: "Курьер",
      body: "ищу",
    });
    const r = await srv.listThreads(ctx("b"), { section: "offers", topic: "photo" });
    expect(r.threads.map((t) => t.title)).toEqual(["Фотограф"]);
  });

  it("страницы: ничего не теряется, «ещё» по смещению", async () => {
    for (let i = 0; i < 25; i++) {
      db.tables.community_threads!.push({
        id: `t${String(i).padStart(2, "0")}`,
        bot_id: "a",
        section: "questions",
        topic: null,
        title: `Тема ${i}`,
        body: "x",
        posts_count: 0,
        hidden: false,
        last_post_at: new Date(2026, 9, 1, 0, i).toISOString(),
        created_at: "2026-10-01T00:00:00Z",
      });
    }
    const p1 = await srv.listThreads(ctx("b"), { section: "questions" });
    expect(p1.threads).toHaveLength(20);
    expect(p1.next).not.toBeNull();
    const p2 = await srv.listThreads(ctx("b"), { section: "questions", offset: p1.next! });
    expect(p2.threads).toHaveLength(5);
    expect(p2.next).toBeNull();
    const all = new Set([...p1.threads, ...p2.threads].map((t) => t.id));
    expect(all.size).toBe(25);
  });
});

describe("сообщество: защита от спама", () => {
  it("11-я запись за час отклоняется, 4-я тема за сутки — тоже", async () => {
    for (let i = 0; i < 3; i++)
      await srv.createThread(ctx("a"), { section: "questions", title: `Тема ${i}`, body: "x" });
    await expect(
      srv.createThread(ctx("a"), { section: "questions", title: "Тема 4", body: "x" }),
    ).rejects.toThrow("достаточно тем");
    const { threads } = await srv.listThreads(ctx("a"), { section: "questions" });
    for (let i = 0; i < 7; i++) await srv.createPost(ctx("a"), threads[0]!.id, `Ответ ${i}`);
    await expect(srv.createPost(ctx("a"), threads[0]!.id, "ещё")).rejects.toThrow("за час");
    // Другой автор не задет.
    await srv.createPost(ctx("b"), threads[0]!.id, "Ответ Бори");
  });

  it("пустой текст и короткий заголовок отклоняются, в базу ничего не пишется", async () => {
    await expect(
      srv.createThread(ctx("a"), { section: "questions", title: "ab", body: "x" }),
    ).rejects.toThrow("от 3 символов");
    await expect(
      srv.createThread(ctx("a"), { section: "questions", title: "Тема", body: "  " }),
    ).rejects.toThrow("Напишите");
    expect(db.tables.community_threads).toHaveLength(0);
  });

  it("счётчик ответов считает видимые", async () => {
    const { id } = await srv.createThread(ctx("a"), {
      section: "questions",
      title: "Тема",
      body: "x",
    });
    await srv.createPost(ctx("b"), id, "1");
    await srv.createPost(ctx("b"), id, "2");
    expect(db.tables.community_threads![0]!.posts_count).toBe(2);
  });
});

describe("сообщество: жалобы и модерация", () => {
  it("жалоба один раз: двойной клик не плодит строки; на своё нельзя", async () => {
    const { id } = await srv.createThread(ctx("a"), {
      section: "questions",
      title: "Тема",
      body: "x",
    });
    const [r1, r2] = await Promise.all([
      srv.reportContent(ctx("b"), { threadId: id, reason: "реклама" }),
      srv.reportContent(ctx("b"), { threadId: id, reason: "реклама" }),
    ]);
    expect([r1.already, r2.already].sort()).toEqual([false, true]);
    expect(db.tables.community_reports).toHaveLength(1);
    await expect(srv.reportContent(ctx("a"), { threadId: id })).rejects.toThrow("свою запись");
  });

  it("оператор скрывает тему: она исчезает и все жалобы на неё закрыты; повтор безвреден", async () => {
    const { id } = await srv.createThread(ctx("a"), {
      section: "questions",
      title: "Тема",
      body: "x",
    });
    await srv.reportContent(ctx("b"), { threadId: id });
    const open = await mod.listOpenReports();
    expect(open.total).toBe(1);
    expect(open.reports[0]).toMatchObject({
      kind: "thread",
      author: "Магазин Аня",
      reporter: "Магазин Боря",
    });
    await mod.resolveReport(open.reports[0]!.id, "hide");
    await mod.resolveReport(open.reports[0]!.id, "hide");
    expect(db.tables.community_threads![0]).toMatchObject({ hidden: true, hidden_by: "operator" });
    expect((await mod.listOpenReports()).total).toBe(0);
    expect((await srv.listThreads(ctx("b"), { section: "questions" })).threads).toEqual([]);
  });

  it("оператор скрывает ответ; «отклонить» ничего не скрывает", async () => {
    const { id } = await srv.createThread(ctx("a"), {
      section: "questions",
      title: "Тема",
      body: "x",
    });
    const post = await srv.createPost(ctx("b"), id, "спам");
    await srv.reportContent(ctx("a"), { threadId: id, postId: post.id });
    const [rep] = (await mod.listOpenReports()).reports;
    expect(rep).toMatchObject({ kind: "post", text: "спам" });
    await mod.resolveReport(rep!.id, "dismiss");
    expect(db.tables.community_posts![0]!.hidden).toBe(false);
    await srv.reportContent(ctx("a"), { threadId: id, postId: post.id }).catch(() => {});
    expect(db.tables.community_reports).toHaveLength(1);
  });
});

describe("сообщество: таблиц ещё нет", () => {
  it("отвечает «скоро», а не падает", async () => {
    const { orSoon } = await import("./not-ready");
    const broken = {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              order: () => ({
                order: () => ({
                  range: async () => ({
                    data: null,
                    error: {
                      code: "PGRST205",
                      message: "Could not find the table 'public.community_threads'",
                    },
                  }),
                }),
              }),
            }),
          }),
        }),
      }),
    };
    const real = db.from;
    db.from = broken.from as never;
    try {
      expect(await orSoon(() => srv.listThreads(ctx("a"), { section: "questions" }))).toEqual({
        soon: true,
      });
    } finally {
      db.from = real;
    }
  });
});
