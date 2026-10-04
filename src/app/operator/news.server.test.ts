import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";

/** Новости, сторона оператора: черновик → публикация один раз → архив. */
let db: FakeDb;
vi.mock("@/core/db/client.server", () => ({ serviceDb: () => db }));

const { listNews, saveNews, setNewsState } = await import("./news.server");

const input = {
  title: { ru: "Розыгрыши в Instagram" },
  body: { ru: "Включите модуль «Розыгрыши»." },
  plans: ["pro" as const],
};

beforeEach(() => {
  db = fakeDb();
});

describe("новости оператора", () => {
  it("сохраняется черновик, продавцам он не опубликован", async () => {
    const n = await saveNews(null, input, "yakov");
    expect(n).toMatchObject({ publishedAt: null, archived: false, plans: ["pro"] });
    expect((await listNews())!.map((x) => x.title.ru)).toEqual(["Розыгрыши в Instagram"]);
  });

  it("публикация — один раз: повтор и гонка ничего не меняют", async () => {
    const n = await saveNews(null, input, "yakov");
    const [a, b] = await Promise.all([
      setNewsState(n.id, "publish"),
      setNewsState(n.id, "publish"),
    ]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
    const first = db.tables.platform_news![0]!.published_at;
    expect(await setNewsState(n.id, "publish")).toBe(false);
    expect(db.tables.platform_news![0]!.published_at).toBe(first);
  });

  it("архив и возврат", async () => {
    const n = await saveNews(null, input, "yakov");
    expect(await setNewsState(n.id, "archive")).toBe(true);
    expect(await setNewsState(n.id, "archive")).toBe(false);
    expect(await setNewsState(n.id, "unarchive")).toBe(true);
  });

  it("список новостей с опросами: 5 и 50 новостей — столько же запросов, итоги верные", async () => {
    async function listing(n: number) {
      db = fakeDb();
      db.tables.platform_news = Array.from({ length: n }, (_, i) => ({
        id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
        title: { ru: `Новость ${i}` },
        body: { ru: "Текст" },
        plans: ["pro"],
        action: null,
        poll: { options: [{ ru: "Да" }, { ru: "Нет" }] },
        published_at: "2026-10-01T00:00:00Z",
        archived: false,
        created_at: `2026-10-01T00:${String(i % 60).padStart(2, "0")}:00Z`,
        created_by: "yakov",
      }));
      db.tables.platform_news_votes = db.tables.platform_news.flatMap((r, i) => [
        { bot_id: `a${i}`, news_id: r.id, option_ix: 0, voted_at: "2026-10-02T00:00:00Z" },
        { bot_id: `b${i}`, news_id: r.id, option_ix: 1, voted_at: "2026-10-02T00:00:00Z" },
        { bot_id: `c${i}`, news_id: r.id, option_ix: 1, voted_at: "2026-10-02T00:00:00Z" },
      ]);
      const list = (await listNews())!;
      expect(list).toHaveLength(n);
      for (const item of list) expect(item.poll!.votes).toEqual([1, 2]);
      return db.queries;
    }
    const few = await listing(5);
    expect(await listing(50)).toBe(few);
  });

  it("правка меняет тексты, чужой id — понятная ошибка", async () => {
    const n = await saveNews(null, input, "yakov");
    const e = await saveNews(n.id, { ...input, title: { ru: "Новый заголовок" } }, "yakov");
    expect(e.title.ru).toBe("Новый заголовок");
    await expect(saveNews("00000000-0000-4000-8000-000000000000", input, "y")).rejects.toThrow(
      "не найдена",
    );
  });

  it("кнопка действия сохраняется, читается обратно и проверяется до записи", async () => {
    const n = await saveNews(
      null,
      { ...input, action: { kind: "link", path: "/admin/billing" } },
      "yakov",
    );
    expect(n.action).toEqual({ kind: "link", path: "/admin/billing" });
    expect((await listNews())![0]!.action).toEqual({ kind: "link", path: "/admin/billing" });
    const cleared = await saveNews(n.id, { ...input, action: null }, "yakov");
    expect(cleared.action).toBeNull();
    await expect(
      saveNews(null, { ...input, action: { kind: "link", path: "https://x.example" } }, "y"),
    ).rejects.toThrow("Подробнее");
    expect(db.tables.platform_news).toHaveLength(1);
  });

  it("опрос: итоги по вариантам, после публикации варианты не меняются", async () => {
    const poll = { ru: "Склад\nДоставка\nРозыгрыши" };
    const n = await saveNews(null, { ...input, pollOptions: poll }, "yakov");
    expect(n.poll).toEqual({
      options: [{ ru: "Склад" }, { ru: "Доставка" }, { ru: "Розыгрыши" }],
      votes: [0, 0, 0],
    });
    // Правка черновика меняет варианты свободно.
    const edited = await saveNews(n.id, { ...input, pollOptions: { ru: "Да\nНет" } }, "yakov");
    expect(edited.poll!.options).toEqual([{ ru: "Да" }, { ru: "Нет" }]);
    await setNewsState(n.id, "publish");
    db.tables.platform_news_votes = [
      { bot_id: "b1", news_id: n.id, option_ix: 0, voted_at: "2026-10-04T00:00:00Z" },
      { bot_id: "b2", news_id: n.id, option_ix: 0, voted_at: "2026-10-04T00:00:00Z" },
      { bot_id: "b3", news_id: n.id, option_ix: 1, voted_at: "2026-10-04T00:00:00Z" },
    ];
    expect((await listNews())![0]!.poll!.votes).toEqual([2, 1]);
    // После публикации: тексты правятся, варианты — нет.
    const retitled = await saveNews(
      n.id,
      { ...input, title: { ru: "Новый заголовок" }, pollOptions: { ru: "Да\nНет" } },
      "yakov",
    );
    expect(retitled.poll!.votes).toEqual([2, 1]);
    await expect(
      saveNews(n.id, { ...input, pollOptions: { ru: "Нет\nДа" } }, "yakov"),
    ).rejects.toThrow("после публикации");
    await expect(saveNews(n.id, { ...input }, "yakov")).rejects.toThrow("после публикации");
  });

  it("таблиц нет — null, а не ошибка", async () => {
    const chain: unknown = new Proxy(
      {},
      {
        get: (_t, k) =>
          k === "then"
            ? (ok: (v: unknown) => unknown) =>
                Promise.resolve({ data: null, error: { code: "PGRST205", message: "x" } }).then(ok)
            : () => chain,
      },
    );
    db = { from: () => chain } as unknown as FakeDb;
    expect(await listNews()).toBeNull();
    await expect(saveNews(null, input, "y")).rejects.toThrow("миграция 19-5");
  });
});
