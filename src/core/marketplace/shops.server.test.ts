import { beforeEach, describe, expect, it } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import { withBrokenReads } from "../../../tests/broken-db";
import type { Db } from "@/core/db/client.server";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Tenant, TenantSettings } from "@/core/tenant/types";
import { MARKET_PAGE, cleanLabel, shopRating, tally } from "./shops";
import {
  listMarketShops,
  marketFacets,
  refreshMarketplaceShop,
  shownShopIds,
} from "./shops.server";

/** Каталог площадки: сбор строки раз в час, чтение страницы, «таблицы нет», сбой чтения. */
let svc: FakeDb;
let shop: FakeDb;
const as = (d: FakeDb) => d as unknown as Db;

const tenant = (id: string, settings: TenantSettings, name = id): Tenant =>
  ({ id, name, vertical: "confectionery", settings }) as unknown as Tenant;
const ctxFor = (t: Tenant, d: FakeDb = shop) =>
  ({ tenant: t, db: as(d) }) as unknown as TenantContext;
const OPEN: TenantSettings = {
  served_by: "v2",
  slug: "cakes",
  marketplace: { listed: true, approved: true },
};

beforeEach(() => {
  svc = fakeDb({ unique: { marketplace_shops: [["bot_id"], ["slug"]] } });
  shop = fakeDb();
});

describe("оценка магазина", () => {
  it("среднее по товарам взвешено числом оценок, без оценок — null", () => {
    expect(
      shopRating([
        { rating_avg: 5, rating_count: 1 },
        { rating_avg: 4, rating_count: 3 },
        { rating_avg: null, rating_count: 0 },
      ]),
    ).toEqual({ rating: 4.25, count: 4 });
    expect(shopRating([])).toEqual({ rating: null, count: 0 });
    expect(shopRating([{ rating_avg: 5, rating_count: 0 }])).toEqual({ rating: null, count: 0 });
  });

  it("поисковая строка без управляющих символов запроса", () => {
    expect(cleanLabel("  торт%,(х)  ")).toBe("торт х");
    expect(cleanLabel(5)).toBe("");
    expect(cleanLabel("а".repeat(100))).toHaveLength(60);
    expect(tally(["б", "а", "б", ""])).toEqual([
      { value: "б", count: 2 },
      { value: "а", count: 1 },
    ]);
  });
});

describe("крон: сбор строки каталога", () => {
  it("согласный и одобренный магазин попадает в каталог с оценкой и нишей", async () => {
    shop.tables.products = [
      { id: "p1", bot_id: "b1", is_active: true, rating_avg: 5, rating_count: 2 },
      { id: "p2", bot_id: "b1", is_active: true, rating_avg: 4, rating_count: 2 },
      { id: "p3", bot_id: "b1", is_active: false, rating_avg: 1, rating_count: 9 },
    ];
    // в products.rating_* входят и скрытые отзывы; в оценку магазина — только одобренные
    shop.tables.product_reviews = [
      { id: "r1", bot_id: "b1", product_id: "p1", rating: 5 },
      { id: "r2", bot_id: "b1", product_id: "p1", rating: 5 },
      { id: "r3", bot_id: "b1", product_id: "p2", rating: 4 },
      { id: "r4", bot_id: "b1", product_id: "p2", rating: 1 },
      { id: "r5", bot_id: "b1", product_id: "p2", rating: 1 },
    ];
    const approved = JSON.stringify({ status: "approved", photos: [] });
    shop.tables.app_settings = [
      { bot_id: "b1", key: "review_meta:r1", value: approved },
      { bot_id: "b1", key: "review_meta:r2", value: approved },
      { bot_id: "b1", key: "review_meta:r3", value: approved },
      {
        bot_id: "b1",
        key: "review_meta:r4",
        value: JSON.stringify({ status: "hidden", photos: [] }),
      },
    ];
    const r = await refreshMarketplaceShop(ctxFor(tenant("b1", OPEN, "Сладкая")), as(svc));
    expect(r.action).toBe("listed");
    expect(svc.tables.marketplace_shops).toHaveLength(1);
    expect(svc.tables.marketplace_shops![0]).toMatchObject({
      bot_id: "b1",
      slug: "cakes",
      name: "Сладкая",
      category: "Кондитерская",
      rating: 4.67,
      rating_count: 3,
    });
  });

  it("повторный проход обновляет ту же строку, а не плодит новые", async () => {
    const ctx = ctxFor(tenant("b1", OPEN));
    await refreshMarketplaceShop(ctx, as(svc));
    await refreshMarketplaceShop(
      ctxFor(tenant("b1", { ...OPEN, marketplace: { ...OPEN.marketplace, city: "Алматы" } })),
      as(svc),
    );
    expect(svc.tables.marketplace_shops).toHaveLength(1);
    expect(svc.tables.marketplace_shops![0]).toMatchObject({ city: "Алматы" });
  });

  it.each([
    ["выключил участие", { ...OPEN, marketplace: { approved: true } }],
    ["оператор скрыл", { ...OPEN, marketplace: { listed: true, approved: true, hidden: true } }],
    ["ещё не одобрен", { ...OPEN, marketplace: { listed: true } }],
    ["ушёл с v2", { ...OPEN, served_by: "v1" as const }],
    ["нет короткого имени", { ...OPEN, slug: undefined }],
  ])("%s — строка пропадает из каталога, чужие остаются", async (_n, settings) => {
    svc.tables.marketplace_shops = [
      {
        bot_id: "b1",
        slug: "cakes",
        name: "A",
        category: "",
        city: "",
        rating: null,
        rating_count: 0,
      },
      {
        bot_id: "b2",
        slug: "other",
        name: "B",
        category: "",
        city: "",
        rating: null,
        rating_count: 0,
      },
    ];
    const r = await refreshMarketplaceShop(ctxFor(tenant("b1", settings)), as(svc));
    expect(r.action).toBe("removed");
    expect(svc.tables.marketplace_shops!.map((x) => x.bot_id)).toEqual(["b2"]);
  });

  it("два крона одновременно — одна строка, а не две", async () => {
    const ctx = ctxFor(tenant("b1", OPEN));
    await Promise.all([refreshMarketplaceShop(ctx, as(svc)), refreshMarketplaceShop(ctx, as(svc))]);
    expect(svc.tables.marketplace_shops).toHaveLength(1);
  });

  it("несогласный магазин в каталог не попадает вообще", async () => {
    await refreshMarketplaceShop(ctxFor(tenant("b1", { served_by: "v2", slug: "cakes" })), as(svc));
    expect(svc.tables.marketplace_shops ?? []).toHaveLength(0);
  });

  it("таблицы нет — не ошибка, а «not-ready»", async () => {
    const missing = {
      from: () => {
        const result = {
          data: null,
          error: { code: "PGRST205", message: "Could not find the table" },
        };
        const q: Record<string, unknown> = {};
        const p: unknown = new Proxy(q, {
          get: (_t, k) =>
            k === "then"
              ? (ok: (v: unknown) => unknown) => Promise.resolve(result).then(ok)
              : () => p,
        });
        return p;
      },
    } as unknown as Db;
    expect((await refreshMarketplaceShop(ctxFor(tenant("b1", OPEN)), missing)).action).toBe(
      "not-ready",
    );
    expect(
      (await refreshMarketplaceShop(ctxFor(tenant("b1", { served_by: "v2" })), missing)).action,
    ).toBe("not-ready");
  });

  it("не удалось прочитать оценки — ошибка, магазин из каталога не убирается", async () => {
    svc.tables.marketplace_shops = [
      {
        bot_id: "b1",
        slug: "cakes",
        name: "A",
        category: "",
        city: "",
        rating: null,
        rating_count: 0,
      },
    ];
    const broken = withBrokenReads(shop, ["products"]);
    await expect(
      refreshMarketplaceShop(ctxFor(tenant("b1", OPEN), broken), as(svc)),
    ).rejects.toThrow(/товары с оценками/);
    expect(svc.tables.marketplace_shops).toHaveLength(1);
  });
});

describe("страница каталога", () => {
  const row = (i: number, extra: Record<string, unknown> = {}) => ({
    bot_id: `b${String(i).padStart(3, "0")}`,
    slug: `s${i}`,
    name: `Магазин ${String(i).padStart(3, "0")}`,
    category: "Торты",
    city: "Алматы",
    rating: null,
    rating_count: 0,
    ...extra,
  });
  const all = (n: number) => async () =>
    new Set(Array.from({ length: n }, (_, i) => row(i).bot_id));

  it("не показывает строку магазина, которого справочник не считает участником", async () => {
    svc.tables.marketplace_shops = [row(1), row(2), row(3)];
    const shown = async () => new Set([row(1).bot_id, row(3).bot_id]);
    const r = await listMarketShops({}, { svc: as(svc), shown });
    expect(r.shops.map((s) => s.id)).toEqual([row(1).bot_id, row(3).bot_id]);
    expect(r.next).toBeNull();
  });

  it("справочник: участник — только согласный, одобренный, не скрытый и на v2", () => {
    const ids = shownShopIds([
      tenant("a", OPEN),
      tenant("b", { ...OPEN, marketplace: { listed: true } }),
      tenant("c", { ...OPEN, marketplace: { listed: true, approved: true, hidden: true } }),
      tenant("d", { ...OPEN, served_by: "v1" }),
    ]);
    expect([...ids]).toEqual(["a"]);
  });

  it("постранично: ни дублей, ни потерь, порядок по названию и id", async () => {
    const n = MARKET_PAGE + 10;
    svc.tables.marketplace_shops = Array.from({ length: n }, (_, i) => row(i)).reverse();
    const first = await listMarketShops({}, { svc: as(svc), shown: all(n) });
    expect(first.shops).toHaveLength(MARKET_PAGE);
    expect(first.next).toBe(MARKET_PAGE);
    const second = await listMarketShops({ offset: first.next! }, { svc: as(svc), shown: all(n) });
    expect(second.shops).toHaveLength(10);
    expect(second.next).toBeNull();
    const ids = [...first.shops, ...second.shops].map((s) => s.id);
    expect(new Set(ids).size).toBe(n);
    expect(ids).toEqual([...ids].sort());
  });

  it("скрытые строки внутри страницы не обрывают просмотр", async () => {
    // 120 строк подряд скрыты, участник — только последняя: страница всё равно её находит.
    svc.tables.marketplace_shops = Array.from({ length: 121 }, (_, i) => row(i));
    const shown = async () => new Set([row(120).bot_id]);
    const r = await listMarketShops({}, { svc: as(svc), shown });
    expect(r.shops.map((s) => s.id)).toEqual([row(120).bot_id]);
  });

  it("фильтры по категории, городу и названию", async () => {
    svc.tables.marketplace_shops = [
      row(1, { category: "Торты", city: "Алматы", name: "Сладкая" }),
      row(2, { category: "Цветы", city: "Алматы", name: "Роза" }),
      row(3, { category: "Торты", city: "Астана", name: "Медовик" }),
    ];
    const run = (q: Parameters<typeof listMarketShops>[0]) =>
      listMarketShops(q, { svc: as(svc), shown: all(5) }).then((r) => r.shops.map((s) => s.name));
    expect(await run({ category: "Торты" })).toEqual(["Медовик", "Сладкая"]);
    expect(await run({ city: "Алматы" })).toEqual(["Роза", "Сладкая"]);
    expect(await run({ category: "Торты", city: "Астана" })).toEqual(["Медовик"]);
    expect(await run({ search: "роз" })).toEqual(["Роза"]);
    expect(await run({ search: "%" })).toHaveLength(3);
  });

  it("категории и города — только у показываемых магазинов, с числом", async () => {
    svc.tables.marketplace_shops = [
      row(1, { category: "Торты", city: "Алматы" }),
      row(2, { category: "Торты", city: "Астана" }),
      row(3, { category: "Цветы", city: "Алматы" }),
    ];
    const shown = async () => new Set([row(1).bot_id, row(2).bot_id]);
    const f = await marketFacets({ svc: as(svc), shown });
    expect(f.categories).toEqual([{ value: "Торты", count: 2 }]);
    expect(f.cities).toEqual([
      { value: "Алматы", count: 1 },
      { value: "Астана", count: 1 },
    ]);
  });

  it("сбой чтения — ошибка, а не пустой каталог", async () => {
    const broken = withBrokenReads(svc, ["marketplace_shops"]);
    await expect(listMarketShops({}, { svc: as(broken), shown: all(1) })).rejects.toThrow();
    await expect(marketFacets({ svc: as(broken), shown: all(1) })).rejects.toThrow();
  });
});
