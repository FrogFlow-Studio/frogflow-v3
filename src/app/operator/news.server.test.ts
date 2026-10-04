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
