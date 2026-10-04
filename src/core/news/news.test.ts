import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { UserError } from "@/core/i18n/user-error";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import { withBrokenReads } from "../../../tests/broken-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import {
  NEWS_LINK_PATHS,
  NewsInputError,
  cleanAction,
  cleanNews,
  cleanPoll,
  itemAction,
  parsePoll,
  voteNews,
  parseAction,
  safeLinkPath,
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
  db = fakeDb({
    unique: {
      platform_news_reads: [["bot_id", "news_id"]],
      platform_news_votes: [["bot_id", "news_id"]],
    },
  });
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
      action: null,
      poll: null,
    });
    expect(() => cleanNews({ title: { en: "x" }, body: { ru: "т" }, plans: [] })).toThrow(
      NewsInputError,
    );
    expect(() =>
      cleanNews({ title: { ru: "а".repeat(121) }, body: { ru: "т" }, plans: [] }),
    ).toThrow(NewsInputError);
  });
});

describe("новость с действием (Ч6)", () => {
  it("«Подробнее» ведёт только на страницы админки из списка", () => {
    expect(safeLinkPath("/admin/billing")).toBe("/admin/billing");
    expect(safeLinkPath("/admin/support?a=bot-silent")).toBe("/admin/support?a=bot-silent");
    for (const bad of [
      "https://evil.example/admin",
      "//evil.example",
      "javascript:alert(1)",
      "/operator",
      "/admin/../operator",
      "/admin/unknown",
      "/admin/billing?x=<script>",
      "/admin/billing#frag",
      "",
      null,
      42,
    ])
      expect(safeLinkPath(bad), String(bad)).toBeNull();
  });

  it("каждая страница из списка есть среди маршрутов", () => {
    const tree = readFileSync("src/routeTree.gen.ts", "utf8");
    const full = new Set([...tree.matchAll(/fullPath: '([^']+)'/g)].map((m) => m[1]));
    for (const p of NEWS_LINK_PATHS) expect(full.has(p), p).toBe(true);
  });

  it("оператор: «Включить» только для готового модуля, «Подробнее» только по списку", () => {
    expect(cleanAction({ kind: "module", module: "giveaways" })).toEqual({
      kind: "module",
      module: "giveaways",
    });
    expect(() => cleanAction({ kind: "module", module: "net-takogo" })).toThrow(NewsInputError);
    expect(() => cleanAction({ kind: "link", path: "https://x.example" })).toThrow(NewsInputError);
    expect(cleanAction(null)).toBeNull();
  });

  it("из базы читается только понятное действие", () => {
    expect(parseAction({ kind: "module", module: "giveaways" })).toEqual({
      kind: "module",
      module: "giveaways",
    });
    expect(parseAction({ kind: "module", module: "net-takogo" })).toBeNull();
    expect(parseAction({ kind: "link", path: "https://x.example" })).toBeNull();
    expect(parseAction("строка")).toBeNull();
    expect(parseAction(null)).toBeNull();
  });

  it("«Включить» ведёт в «Модули» и пропадает, когда модуль уже включён", () => {
    const a = { kind: "module", module: "giveaways" } as const;
    expect(itemAction(a, { giveaways: false })).toEqual({ kind: "module", href: "/admin/modules" });
    expect(itemAction(a, { giveaways: true })).toBeNull();
    expect(itemAction({ kind: "link", path: "/admin/billing" }, {})).toEqual({
      kind: "link",
      href: "/admin/billing",
    });
  });

  it("продавец получает кнопку вместе с новостью", async () => {
    db.tables.platform_news!.push(
      news("n-act", {
        action: { kind: "module", module: "giveaways" },
        published_at: "2026-10-03T10:00:00Z",
      }),
    );
    const ctx = {
      tenant: { id: "b1", plan: null, modules: { giveaways: false } },
      db,
    } as unknown as TenantContext;
    const v = await loadNews(ctx, "ru");
    expect(v.available && v.items.find((i) => i.id === "n-act")?.action).toEqual({
      kind: "module",
      href: "/admin/modules",
    });
  });
});

describe("опрос в ленте (Ч7)", () => {
  const poll = { options: [{ ru: "Склад", en: "Warehouse" }, { ru: "Доставка" }] };
  const ctx = (id: string, plan: string | null = null) =>
    ({ tenant: { id, plan, modules: {} }, db }) as unknown as TenantContext;
  beforeEach(() => {
    db.tables.platform_news!.push(news("n-poll", { poll, published_at: "2026-10-03T10:00:00Z" }));
  });

  it("опрос читается из базы: 2–4 варианта с русским текстом, остальное — нет", () => {
    expect(parsePoll(poll)).toEqual(poll);
    expect(parsePoll({ options: [{ ru: "один" }] })).toBeNull();
    expect(
      parsePoll({ options: [{ ru: "а" }, { ru: "б" }, { ru: "в" }, { ru: "г" }, { ru: "д" }] }),
    ).toBeNull();
    expect(parsePoll({ options: [{ ru: "а" }, { en: "b" }] })).toBeNull();
    expect(parsePoll("строка")).toBeNull();
    expect(parsePoll(null)).toBeNull();
  });

  it("продавец видит варианты на своём языке и свой голос", async () => {
    const before = await loadNews(ctx("b1"), "en");
    expect(before.available && before.items.find((i) => i.id === "n-poll")?.poll).toEqual({
      options: ["Warehouse", "Доставка"],
      myVote: null,
    });
    await voteNews(ctx("b1"), "n-poll", 1);
    const after = await loadNews(ctx("b1"), "ru");
    expect(after.available && after.items.find((i) => i.id === "n-poll")?.poll?.myVote).toBe(1);
    const other = await loadNews(ctx("b2"), "ru");
    expect(other.available && other.items.find((i) => i.id === "n-poll")?.poll?.myVote).toBeNull();
  });

  it("голос один: повтор не меняет выбор и не ошибка", async () => {
    expect(await voteNews(ctx("b1"), "n-poll", 0)).toEqual({ counted: true });
    expect(await voteNews(ctx("b1"), "n-poll", 1)).toEqual({ counted: false });
    expect(db.tables.platform_news_votes).toHaveLength(1);
    expect(db.tables.platform_news_votes![0]).toMatchObject({ bot_id: "b1", option_ix: 0 });
  });

  it("двойной клик и две вкладки сразу: засчитан один голос (гонка)", async () => {
    const r = await Promise.all([
      voteNews(ctx("b1"), "n-poll", 0),
      voteNews(ctx("b1"), "n-poll", 1),
      voteNews(ctx("b1"), "n-poll", 0),
    ]);
    expect(r.filter((x) => x.counted)).toHaveLength(1);
    expect(db.tables.platform_news_votes).toHaveLength(1);
  });

  it("магазины голосуют независимо", async () => {
    await voteNews(ctx("b1"), "n-poll", 0);
    await voteNews(ctx("b2"), "n-poll", 0);
    expect(db.tables.platform_news_votes).toHaveLength(2);
  });

  it("нельзя: нет такого варианта, новость без опроса, черновик, чужой тариф, чужая новость", async () => {
    db.tables.platform_news!.push(
      news("n-draft-poll", { poll, published_at: null }),
      news("n-biz-poll", { poll, plans: ["business"] }),
    );
    for (const [id, ix, plan] of [
      ["n-poll", 2, null],
      ["n-poll", -1, null],
      ["n-poll", 0.5, null],
      ["n-all", 0, null],
      ["n-draft-poll", 0, null],
      ["n-biz-poll", 0, "flowers.basic"],
      ["нет-такой", 0, null],
    ] as const)
      await expect(voteNews(ctx("b1", plan), id, ix), `${id}/${ix}`).rejects.toBeInstanceOf(
        UserError,
      );
    expect(db.tables.platform_news_votes ?? []).toHaveLength(0);
  });

  it("оператор: русский список 2–4 строки, другие языки — столько же или пусто", () => {
    expect(cleanPoll({})).toBeNull();
    expect(cleanPoll({ ru: "  \n " })).toBeNull();
    expect(cleanPoll({ ru: "Склад\r\nДоставка", en: "Warehouse\nDelivery" })).toEqual({
      options: [
        { ru: "Склад", en: "Warehouse" },
        { ru: "Доставка", en: "Delivery" },
      ],
    });
    expect(() => cleanPoll({ ru: "один" })).toThrow(NewsInputError);
    expect(() => cleanPoll({ ru: "а\nб\nв\nг\nд" })).toThrow(NewsInputError);
    expect(() => cleanPoll({ ru: "а\nб", en: "a" })).toThrow(NewsInputError);
    expect(() => cleanPoll({ ru: `а\n${"б".repeat(81)}` })).toThrow(NewsInputError);
    expect(() => cleanPoll({ en: "a\nb" })).toThrow(NewsInputError);
  });
});
