import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NO_STORE, PUBLIC_PAGE, privateHeaders, publicHeaders, withNoStore } from "./cache-policy";

/**
 * Заголовки кеширования по списку маршрутов (С4). Страница либо в списке общих (короткий общий кеш),
 * либо закрыта по умолчанию корневым маршрутом. Новый маршрут, которого нет ни в одном списке,
 * роняет тест: решение «общий или закрытый» принимается явно.
 */
const ROUTES = join(process.cwd(), "src/routes");
const read = (f: string) => readFileSync(join(ROUTES, f), "utf8");

/** Одинаковые для всех покупателей, без входа и токенов: каталог площадки, витрина, визитки. */
const PUBLIC = [
  "index.tsx",
  "for.$niche.tsx",
  "blog.$slug.tsx",
  "author.$slug.tsx",
  "market.index.tsx",
  "market.search.tsx",
  "market.rules.tsx",
  "s.$slug.index.tsx",
  "s.$slug.p.$id.tsx",
  "s.$slug.c.$category.tsx",
  "s.$slug.col.$id.tsx",
  "s.$slug.about.tsx",
  "s.$slug.legal.$doc.tsx",
];

/** Зависят от входа, корзины, ссылки заказа с токеном, формы с задачей против ботов — закрыты. */
const PRIVATE = [
  "market.account.tsx",
  "market.report.tsx",
  "market.open.tsx",
  "s.$slug.cart.tsx",
  "s.$slug.checkout.tsx",
  "s.$slug.orders.tsx",
  "s.$slug.favorites.tsx",
  "s.$slug.order.$id.tsx",
  "s.$slug.cert.$code.tsx",
  "s.$slug.course.$itemId.tsx",
  "s.$slug.gift.tsx",
  "s.$slug.giveaway.$id.tsx",
  "s.$slug.quiz.tsx",
  "partner.$code.tsx",
  "signup.tsx",
  "status.tsx",
];

/** Каркас, служебные файлы без страницы (ресурсы витрины, robots, карты сайта) и панели. */
const NOT_PAGES = (f: string) =>
  f === "api" ||
  f === "__root.tsx" ||
  f === "market.tsx" ||
  f === "s.$slug.tsx" ||
  !f.endsWith(".tsx") ||
  f.startsWith("admin") ||
  f.startsWith("operator");

describe("страницы: общий кеш только у названных", () => {
  it("общие страницы отдают короткий общий кеш", () => {
    expect(publicHeaders()).toEqual({ "Cache-Control": PUBLIC_PAGE });
    expect(PUBLIC_PAGE).toMatch(/^public, .*s-maxage=60/);
    for (const f of PUBLIC) expect(read(f), f).toMatch(/headers:\s*publicHeaders/);
  });

  it("корень закрывает всё остальное: private, no-store", () => {
    expect(privateHeaders()).toEqual({ "Cache-Control": NO_STORE });
    expect(NO_STORE).toBe("private, no-store");
    expect(read("__root.tsx")).toMatch(/headers:\s*privateHeaders/);
  });

  it("закрытые страницы не берут общий кеш", () => {
    for (const f of PRIVATE) expect(read(f), f).not.toMatch(/publicHeaders/);
  });

  it("страница заказа по ссылке с токеном — no-store своими заголовками", () => {
    expect(read("s.$slug.order.$id.tsx")).toMatch(/headers:\s*\(\)\s*=>\s*ORDER_PAGE_HEADERS/);
  });

  it("панели продавца и оператора общий кеш не берут", () => {
    for (const f of readdirSync(ROUTES).filter((x) => /^(admin|operator)/.test(x)))
      if (f.endsWith(".tsx")) expect(read(f), f).not.toMatch(/publicHeaders/);
  });

  it("каждая страница есть ровно в одном списке", () => {
    const all = readdirSync(ROUTES).filter((f) => !NOT_PAGES(f));
    const listed = new Set([...PUBLIC, ...PRIVATE]);
    expect(PUBLIC.filter((f) => PRIVATE.includes(f))).toEqual([]);
    expect(all.filter((f) => !listed.has(f))).toEqual([]);
    expect([...listed].filter((f) => !all.includes(f))).toEqual([]);
  });
});

describe("API: ответ не кешируется без явной политики", () => {
  const API = join(ROUTES, "api");
  const files = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
      d.isDirectory() ? files(join(dir, d.name)) : [join(dir, d.name)],
    );
  // Только POST: ответ на POST ни браузер, ни общий кеш не хранят.
  const POST_ONLY = [
    "telegram.$botId.ts",
    "telegram.$botId.vip.ts",
    "apipay.webhook.ts",
    "nowpayments.$botId.ts",
    "kaspi.$botId.ts",
    "stripe.$botId.ts",
    "client-error.ts",
    "zernio/webhook.ts",
    "admin/upload.ts",
    "operator/bots.ts",
  ];

  it("маршруты только с POST не отдают GET", () => {
    for (const f of POST_ONLY) expect(readFileSync(join(API, f), "utf8"), f).not.toMatch(/\bGET:/);
  });

  it("остальные задают политику: no-store через withNoStore или свои заголовки", () => {
    const rest = files(API)
      .map((f) => f.slice(API.length + 1))
      .filter((f) => !POST_ONLY.includes(f));
    expect(rest.length).toBeGreaterThan(5);
    for (const f of rest)
      expect(readFileSync(join(API, f), "utf8"), f).toMatch(/withNoStore|cache-control/i);
  });
});

describe("withNoStore", () => {
  it("ставит no-store, не меняя статус и тело; редирект с неизменяемыми заголовками тоже", async () => {
    const r = withNoStore(Response.redirect("https://x.test/a", 302));
    expect(r.status).toBe(302);
    expect(r.headers.get("location")).toBe("https://x.test/a");
    expect(r.headers.get("cache-control")).toBe(NO_STORE);
    const j = withNoStore(Response.json({ ok: 1 }, { status: 201 }));
    expect(j.status).toBe(201);
    expect(await j.json()).toEqual({ ok: 1 });
    expect(j.headers.get("cache-control")).toBe(NO_STORE);
  });

  it("явную политику ответа не затирает", () => {
    const own = new Response("x", { headers: { "cache-control": "public, max-age=60" } });
    expect(withNoStore(own).headers.get("cache-control")).toBe("public, max-age=60");
  });
});
