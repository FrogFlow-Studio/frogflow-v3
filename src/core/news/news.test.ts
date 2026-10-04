import { beforeEach, describe, expect, it } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import { withBrokenReads } from "../../../tests/broken-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import {
  NewsInputError,
  cleanNews,
  loadNews,
  localized,
  markNewsRead,
  newsUnread,
  newsVisibleTo,
  tenantTier,
} from "./news";

/** Лента новостей, сторона продавца: тарифы, «прочитано», языки, «таблицы нет». */
let db: FakeDb;
const ctxFor = (id: string, plan: string | null, d: FakeDb = db) =>
  ({ tenant: { id, plan }, db: d }) as unknown as TenantContext;

const news = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  title: { ru: `Заголовок ${id}`, en: `Title ${id}` },
  body: { ru: `Текст ${id}` },
  plans: [],
  action: null,
  poll: null,
  published_at: "2026-10-01T10:00:00Z",
  archived: false,
  created_at: "2026-10-01T09:00:00Z",
  created_by: "yakov",
  ...over,
});

beforeEach(() => {
  db = fakeDb({ unique: { platform_news_reads: [["bot_id", "news_id"]] } });
  db.tables.platform_news = [
    news("n-all"),
    news("n-biz", { plans: ["business"], published_at: "2026-10-02T10:00:00Z" }),
    news("n-draft", { published_at: null }),
    news("n-old", { archived: true }),
  ];
});

describe("кому видна новость", () => {
  it("пустой список — всем, иначе нужен уровень тарифа", () => {
    expect(newsVisibleTo([], null)).toBe(true);
    expect(newsVisibleTo(["business"], "business")).toBe(true);
    expect(newsVisibleTo(["business"], "basic")).toBe(false);
    expect(newsVisibleTo(["business"], null)).toBe(false);
    expect(newsVisibleTo(["custom"], "custom")).toBe(true);
  });

  it("уровень берётся из ключа плана", () => {
    expect(tenantTier("flowers.pro")).toBe("pro");
    expect(tenantTier("courses.business")).toBe("business");
    expect(tenantTier("custom")).toBe("custom");
    expect(tenantTier(null)).toBeNull();
    expect(tenantTier("мусор")).toBeNull();
  });

  it("новость для Business не видна на Basic; черновики и архив не видны никому", async () => {
    const basic = await loadNews(ctxFor("b1", "flowers.basic"), "ru");
    expect(basic.available && basic.items.map((i) => i.id)).toEqual(["n-all"]);
    const biz = await loadNews(ctxFor("b2", "flowers.business"), "ru");
    expect(biz.available && biz.items.map((i) => i.id)).toEqual(["n-biz", "n-all"]);
  });
});

describe("прочитано", () => {
  it("открыл — бейдж гаснет, повтор ничего не меняет", async () => {
    const ctx = ctxFor("b1", "flowers.business");
    expect(await newsUnread(ctx)).toBe(2);
    expect(await markNewsRead(ctx)).toBe(2);
    expect(await newsUnread(ctx)).toBe(0);
    expect(await markNewsRead(ctx)).toBe(0);
    expect(db.tables.platform_news_reads).toHaveLength(2);
  });

  it("прочитанное одним магазином у другого остаётся непрочитанным", async () => {
    await markNewsRead(ctxFor("b1", "flowers.business"));
    expect(await newsUnread(ctxFor("b2", "flowers.business"))).toBe(2);
  });

  it("новость, опубликованная позже, снова зажигает бейдж", async () => {
    const ctx = ctxFor("b1", "flowers.basic");
    await markNewsRead(ctx);
    db.tables.platform_news!.push(news("n-new", { published_at: "2026-10-04T10:00:00Z" }));
    expect(await newsUnread(ctx)).toBe(1);
  });

  it("два открытия одновременно: каждая новость отмечена один раз", async () => {
    const ctx = ctxFor("b1", "flowers.business");
    await Promise.all([markNewsRead(ctx), markNewsRead(ctx)]);
    expect(db.tables.platform_news_reads).toHaveLength(2);
  });

  it("не читает чужие тарифу новости как прочитанные", async () => {
    await markNewsRead(ctxFor("b1", "flowers.basic"));
    expect(db.tables.platform_news_reads!.map((r) => r.news_id)).toEqual(["n-all"]);
  });
});

describe("язык", () => {
  it("нужный язык, иначе русский, иначе любой", () => {
    const t = { ru: "Привет", en: "Hello" };
    expect(localized(t, "en")).toBe("Hello");
    expect(localized(t, "kk")).toBe("Привет");
    expect(localized({ uz: "Salom" }, "kk")).toBe("Salom");
    expect(localized(null, "ru")).toBe("");
  });

  it("продавец видит заголовок на языке админки", async () => {
    const v = await loadNews(ctxFor("b1", "flowers.basic"), "en");
    expect(v.available && v.items[0]!.title).toBe("Title n-all");
  });
});

describe("таблиц ещё нет (миграция 19-5 не применена)", () => {
  const missing = () => {
    const err = { data: null, error: { code: "PGRST205", message: "Could not find the table" } };
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
  it("раздел выключен, бейдж 0, отметка ничего не делает", async () => {
    const ctx = ctxFor("b1", null, missing());
    expect(await loadNews(ctx, "ru")).toEqual({ available: false });
    expect(await newsUnread(ctx)).toBe(0);
    expect(await markNewsRead(ctx)).toBe(0);
  });
  it("сбой чтения — не «нет новостей»", async () => {
    await expect(
      loadNews(ctxFor("b1", null, withBrokenReads(db, ["platform_news"])), "ru"),
    ).rejects.toThrow();
    await expect(
      loadNews(ctxFor("b1", null, withBrokenReads(db, ["platform_news_reads"])), "ru"),
    ).rejects.toThrow();
  });
});

describe("ввод оператора", () => {
  it("нужен русский текст, пустые языки не пишутся, тарифы без повторов", () => {
    const ok = cleanNews({
      title: { ru: " Новость ", en: "" },
      body: { ru: "Текст", kk: "Мәтін" },
      plans: ["pro", "pro", "business"],
    });
    expect(ok).toEqual({
      title: { ru: "Новость" },
      body: { ru: "Текст", kk: "Мәтін" },
      plans: ["pro", "business"],
    });
    expect(() => cleanNews({ title: { en: "x" }, body: { ru: "т" }, plans: [] })).toThrow(
      NewsInputError,
    );
    expect(() =>
      cleanNews({ title: { ru: "а".repeat(121) }, body: { ru: "т" }, plans: [] }),
    ).toThrow(NewsInputError);
  });
});
