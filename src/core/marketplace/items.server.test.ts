import { beforeEach, describe, expect, it } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import { withBrokenReads } from "../../../tests/broken-db";
import type { Db } from "@/core/db/client.server";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Tenant, TenantSettings } from "@/core/tenant/types";
import { ITEMS_PER_SHOP_MAX, MARKET_ITEMS_PAGE, searchWords } from "./items";
import {
  removeMarketplaceItems,
  searchMarketItems,
  shownShops,
  syncMarketplaceItems,
} from "./items.server";

/** Поиск товаров по площадке: снимок раз в час (настоящая витрина на подставной базе) и поиск по нему. */
let svc: FakeDb;
let shop: FakeDb;
const as = (d: FakeDb) => d as unknown as Db;
const BOT = "b1";
const OPEN: TenantSettings = {
  served_by: "v2",
  slug: "cakes",
  marketplace: { listed: true, approved: true },
};
const ctxFor = (d: FakeDb = shop, settings: TenantSettings = OPEN) =>
  ({
    tenant: {
      id: BOT,
      name: "Лавка",
      vertical: "confectionery",
      modules: { stock: true },
      settings,
    },
    db: d,
  }) as unknown as TenantContext;
const pid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const prod = (n: number, extra: Record<string, unknown> = {}) => ({
  id: pid(n),
  bot_id: BOT,
  name: `Торт ${n}`,
  description: "",
  price: 1000 * n,
  currency: "KZT",
  country_prices: {},
  is_active: true,
  sort_order: n,
  fulfillment_kind: "physical",
  stock_quantity: null,
  category_ids: [],
  rating_count: 0,
  rating_avg: null,
  created_at: new Date(Date.UTC(2026, 0, 1) + n * 3_600_000).toISOString(),
  product_images: [],
  product_variants: [],
  product_material_files: [],
  ...extra,
});
const items = () => (svc.tables.marketplace_items ?? []).map((r) => String(r.product_id)).sort();

beforeEach(() => {
  svc = fakeDb({ unique: { marketplace_items: [["bot_id", "product_id"]] } });
  shop = fakeDb({ maxRows: 1000 });
  shop.tables.products = [prod(1), prod(2), prod(3)];
});

describe("снимок товаров магазина", () => {
  it("попадает то, что покупатель может купить сейчас; скрытое и закончившееся — нет", async () => {
    shop.tables.products = [
      prod(1, { name: "Медовик", description: "С ЯГОДАМИ", price: 9500 }),
      prod(2, { is_active: false }),
      prod(3, { stock_quantity: 0 }),
      prod(4, { stock_quantity: 5 }),
    ];
    const r = await syncMarketplaceItems(ctxFor(), as(svc));
    expect(r).toEqual({ action: "synced", items: 2, removed: 0, truncated: false });
    expect(items()).toEqual([pid(1), pid(4)]);
    expect(svc.tables.marketplace_items!.find((x) => x.product_id === pid(1))).toMatchObject({
      bot_id: BOT,
      name: "Медовик",
      search_text: "медовик с ягодами",
      price: 9500,
      currency: "KZT",
    });
  });

  it("товар скрыт или закончился — уходит при следующем проходе, цена обновляется", async () => {
    await syncMarketplaceItems(ctxFor(), as(svc));
    expect(items()).toEqual([pid(1), pid(2), pid(3)]);
    shop.tables.products![0]!.is_active = false;
    shop.tables.products![1]!.stock_quantity = 0;
    shop.tables.products![2]!.price = 777;
    // Устаревшее — строки со старой меткой прохода: следующий проход часом позже.
    const r = await syncMarketplaceItems(ctxFor(), as(svc), new Date(Date.now() + 3_600_000));
    expect(r).toMatchObject({ action: "synced", items: 1, removed: 2 });
    expect(items()).toEqual([pid(3)]);
    expect(svc.tables.marketplace_items![0]).toMatchObject({ price: 777 });
  });

  it("чужие строки снимка не трогаются", async () => {
    svc.tables.marketplace_items = [
      { bot_id: "other", product_id: pid(99), name: "Чужой", search_text: "чужой", price: 1 },
    ];
    await syncMarketplaceItems(ctxFor(), as(svc));
    await removeMarketplaceItems(BOT, as(svc));
    expect(svc.tables.marketplace_items).toHaveLength(1);
    expect(svc.tables.marketplace_items![0]!.bot_id).toBe("other");
  });

  it("два крона одновременно — без дублей", async () => {
    await Promise.all([
      syncMarketplaceItems(ctxFor(), as(svc)),
      syncMarketplaceItems(ctxFor(), as(svc)),
    ]);
    expect(items()).toEqual([pid(1), pid(2), pid(3)]);
  });

  it("не удалось прочитать витрину — ошибка, снимок остаётся как был", async () => {
    await syncMarketplaceItems(ctxFor(), as(svc));
    const broken = withBrokenReads(shop, ["products"]);
    await expect(syncMarketplaceItems(ctxFor(broken), as(svc))).rejects.toThrow();
    expect(items()).toEqual([pid(1), pid(2), pid(3)]);
  });

  it("больше предела за проход — берём предел и сообщаем, что обрезали", async () => {
    shop.tables.products = Array.from({ length: ITEMS_PER_SHOP_MAX + 50 }, (_, i) => prod(i + 1));
    const r = await syncMarketplaceItems(ctxFor(), as(svc));
    expect(r).toMatchObject({ action: "synced", items: ITEMS_PER_SHOP_MAX, truncated: true });
  });

  it("1000 товаров: бюджет кончился посреди магазина — остановка, продолжение с места без дублей", async () => {
    shop.tables.products = Array.from({ length: 1000 }, (_, i) => prod(i + 1));
    const t0 = new Date();
    // Бюджет «кончается» после каждой страницы витрины: проход рвётся и продолжается.
    const runs: string[] = [];
    let reads = 0;
    const spentAfterOnePage = () => {
      reads++;
      return true;
    };
    let r = await syncMarketplaceItems(ctxFor(), as(svc), t0, { spent: spentAfterOnePage });
    expect(r).toEqual({ action: "partial", items: 100 });
    expect(items()).toHaveLength(100);
    const cursor = JSON.parse(
      String(shop.tables.app_settings!.find((x) => x.key === "marketplace_items_cursor")!.value),
    );
    expect(cursor).toMatchObject({ offset: 100, written: 100 });

    // Повторный запуск с места, не с начала: ровно следующие 100, дублей нет.
    r = await syncMarketplaceItems(ctxFor(), as(svc), new Date(t0.getTime() + 60_000), {
      spent: spentAfterOnePage,
    });
    expect(r).toEqual({ action: "partial", items: 200 });
    expect(items()).toHaveLength(200);
    expect(new Set(items()).size).toBe(200);

    // Бюджета хватает: остаток записан, полный проход закончен, курсор снят.
    for (let i = 0; i < 20 && r.action === "partial"; i++) {
      runs.push(r.action);
      r = await syncMarketplaceItems(ctxFor(), as(svc), new Date(t0.getTime() + 120_000));
    }
    expect(r).toEqual({ action: "synced", items: 1000, removed: 0, truncated: false });
    expect(reads).toBe(2);
    expect(items()).toHaveLength(1000);
    expect(svc.tables.marketplace_items).toHaveLength(1000);
    expect(shop.tables.app_settings!.find((x) => x.key === "marketplace_items_cursor")!.value).toBe(
      "",
    );
  });

  it("обрыв посреди прохода ничего не удаляет: устаревшее уходит только после полного прохода", async () => {
    await syncMarketplaceItems(ctxFor(), as(svc), new Date("2026-10-04T10:00:00Z"));
    shop.tables.products = [prod(1)];
    const r = await syncMarketplaceItems(ctxFor(), as(svc), new Date("2026-10-04T11:00:00Z"), {
      spent: () => true,
    });
    // Витрина из одной страницы: проход завершён сразу, лишнее убрано.
    expect(r).toMatchObject({ action: "synced", items: 1, removed: 2 });
    shop.tables.products = Array.from({ length: 250 }, (_, i) => prod(i + 1));
    const cut = await syncMarketplaceItems(ctxFor(), as(svc), new Date("2026-10-04T12:00:00Z"), {
      spent: () => true,
    });
    expect(cut).toEqual({ action: "partial", items: 100 });
    // Обрыв: прежние строки не тронуты, к проходу добавлены новые.
    expect(items()).toHaveLength(100);
  });

  it("курсор старше шести часов игнорируется: проход начинается с начала", async () => {
    shop.tables.products = Array.from({ length: 250 }, (_, i) => prod(i + 1));
    const t0 = new Date("2026-10-04T10:00:00Z");
    await syncMarketplaceItems(ctxFor(), as(svc), t0, { spent: () => true });
    const r = await syncMarketplaceItems(
      ctxFor(),
      as(svc),
      new Date(t0.getTime() + 7 * 3_600_000),
      {
        spent: () => true,
      },
    );
    expect(r).toEqual({ action: "partial", items: 100 });
  });

  it("сбой чтения курсора — ошибка, а не «курсора нет»", async () => {
    const broken = withBrokenReads(shop, ["app_settings"]);
    await expect(syncMarketplaceItems(ctxFor(broken), as(svc))).rejects.toThrow();
    expect(items()).toEqual([]);
  });

  it("таблицы нет — «not-ready», а не ошибка", async () => {
    const missing = {
      from: () => {
        const result = {
          data: null,
          error: { code: "PGRST205", message: "Could not find the table" },
        };
        const p: unknown = new Proxy(
          {},
          {
            get: (_t, k) =>
              k === "then"
                ? (ok: (v: unknown) => unknown) => Promise.resolve(result).then(ok)
                : () => p,
          },
        );
        return p;
      },
    } as unknown as Db;
    expect(await syncMarketplaceItems(ctxFor(), missing)).toEqual({ action: "not-ready" });
    expect(await removeMarketplaceItems(BOT, missing)).toEqual({ action: "not-ready" });
  });
});

describe("поиск по площадке", () => {
  const row = (n: number, extra: Record<string, unknown> = {}) => ({
    bot_id: BOT,
    product_id: pid(n),
    name: `Торт ${String(n).padStart(3, "0")}`,
    search_text: `торт ${String(n).padStart(3, "0")} с клубникой`,
    price: 1000 + n,
    currency: "KZT",
    image: null,
    updated_at: "2026-10-04T10:00:00.000Z",
    ...extra,
  });
  const shown = async () => new Map([[BOT, { slug: "cakes", name: "Лавка" }]]);

  it("слова запроса: чистые, строчные, не короче двух знаков", () => {
    expect(searchWords("  ТОРТ% к, клубника ")).toEqual(["торт", "клубника"]);
    expect(searchWords("а")).toEqual([]);
    expect(searchWords(undefined)).toEqual([]);
  });

  it("находит по всем словам сразу, с адресом магазина и ценой «на момент»", async () => {
    svc.tables.marketplace_items = [
      row(1),
      row(2, { name: "Эклер", search_text: "эклер с клубникой" }),
      row(3, { name: "Брауни", search_text: "брауни шоколадный" }),
    ];
    const r = await searchMarketItems({ search: "клубникой торт" }, { svc: as(svc), shown });
    expect(r.items.map((i) => i.name)).toEqual(["Торт 001"]);
    expect(r.items[0]).toMatchObject({
      shopSlug: "cakes",
      shopName: "Лавка",
      price: 1001,
      at: "2026-10-04T10:00:00.000Z",
    });
    expect(
      (await searchMarketItems({ search: "клубникой" }, { svc: as(svc), shown })).items,
    ).toHaveLength(2);
  });

  it("категория (П1): только товары магазинов этой категории; одна категория без слов показывает её товары", async () => {
    svc.tables.marketplace_items = [
      row(1),
      row(2, { bot_id: "b2", search_text: "торт с орехами" }),
      row(3, { bot_id: "hidden" }),
    ];
    const two = async () =>
      new Map([
        [BOT, { slug: "cakes", name: "Лавка", category: "Торты" }],
        ["b2", { slug: "flowers", name: "Цветы", category: "Цветы" }],
      ]);
    const byCat = await searchMarketItems({ category: "Торты" }, { svc: as(svc), shown: two });
    expect(byCat.items.map((i) => i.shopSlug)).toEqual(["cakes"]);
    const both = await searchMarketItems({ search: "торт" }, { svc: as(svc), shown: two });
    expect(both.items.map((i) => i.shopSlug).sort()).toEqual(["cakes", "flowers"]);
    const narrowed = await searchMarketItems(
      { search: "торт", category: "Цветы" },
      { svc: as(svc), shown: two },
    );
    expect(narrowed.items.map((i) => i.shopSlug)).toEqual(["flowers"]);
    // скрытый магазин (нет в показанных) не попадает ни в одну категорию
    expect([...byCat.items, ...both.items].some((i) => i.shopId === "hidden")).toBe(false);
  });

  it("пустой и слишком короткий запрос ничего не ищет", async () => {
    svc.tables.marketplace_items = [row(1)];
    for (const q of [undefined, "", " ", "т"])
      expect(await searchMarketItems({ search: q }, { svc: as(svc), shown })).toMatchObject({
        items: [],
        next: null,
      });
  });

  it("магазин, которому показываться нельзя (скрыт, выключил), в поиске не виден, даже если строки остались", async () => {
    svc.tables.marketplace_items = [row(1), row(2, { bot_id: "hidden-shop" })];
    const r = await searchMarketItems({ search: "торт" }, { svc: as(svc), shown });
    expect(r.items.map((i) => i.shopId)).toEqual([BOT]);
  });

  it("справочник: показывается только согласный, одобренный, не скрытый, на v2, с адресом", () => {
    const t = (id: string, settings: TenantSettings) =>
      ({ id, name: id, vertical: "digital", settings }) as unknown as Tenant;
    const map = shownShops([
      t("a", OPEN),
      t("b", { ...OPEN, marketplace: { listed: true } }),
      t("c", { ...OPEN, marketplace: { listed: true, approved: true, hidden: true } }),
      t("d", { ...OPEN, served_by: "v1" }),
      t("e", { ...OPEN, slug: undefined }),
    ]);
    expect([...map.keys()]).toEqual(["a"]);
  });

  it("постранично: ни дублей, ни потерь", async () => {
    const n = MARKET_ITEMS_PAGE + 8;
    svc.tables.marketplace_items = Array.from({ length: n }, (_, i) => row(i + 1)).reverse();
    const first = await searchMarketItems({ search: "торт" }, { svc: as(svc), shown });
    expect(first.items).toHaveLength(MARKET_ITEMS_PAGE);
    const second = await searchMarketItems(
      { search: "торт", offset: first.next! },
      { svc: as(svc), shown },
    );
    expect(second.items).toHaveLength(8);
    expect(second.next).toBeNull();
    const ids = [...first.items, ...second.items].map((i) => i.id);
    expect(new Set(ids).size).toBe(n);
  });

  describe("поиск по автору, категории и с опечатками (Л1)", () => {
    const two = async () =>
      new Map([
        [BOT, { slug: "cakes", name: "Сладкая лавка", category: "Торты" }],
        ["b2", { slug: "flowers", name: "Розовый сад", category: "Цветы" }],
      ]);
    const seed = () => {
      svc.tables.marketplace_items = [
        row(1, { name: "Медовик", search_text: "медовик с орехами" }),
        row(2, { bot_id: "b2", name: "Букет", search_text: "букет из роз" }),
      ];
    };

    it("находит по названию автора и по категории магазина, в том числе вместе со словом товара", async () => {
      seed();
      const byAuthor = await searchMarketItems({ search: "лавка" }, { svc: as(svc), shown: two });
      expect(byAuthor.items.map((i) => i.shopSlug)).toEqual(["cakes"]);
      const byCategory = await searchMarketItems({ search: "цветы" }, { svc: as(svc), shown: two });
      expect(byCategory.items.map((i) => i.shopSlug)).toEqual(["flowers"]);
      const both = await searchMarketItems(
        { search: "сладкая медовик" },
        { svc: as(svc), shown: two },
      );
      expect(both.items.map((i) => i.name)).toEqual(["Медовик"]);
      const wrong = await searchMarketItems(
        { search: "лавка букет" },
        { svc: as(svc), shown: two },
      );
      expect(wrong.items).toEqual([]);
    });

    it("опечатка: «медовк» и «клубнику» находят, об этом сказано; точное совпадение не «с опечаткой»", async () => {
      seed();
      const typo = await searchMarketItems({ search: "медовк" }, { svc: as(svc), shown: two });
      expect(typo).toMatchObject({ fuzzy: true });
      expect(typo.items.map((i) => i.name)).toEqual(["Медовик"]);
      const exactHit = await searchMarketItems({ search: "медовик" }, { svc: as(svc), shown: two });
      expect(exactHit.fuzzy).toBe(false);
      const author = await searchMarketItems({ search: "розавый" }, { svc: as(svc), shown: two });
      expect(author.items.map((i) => i.shopSlug)).toEqual(["flowers"]);
    });

    it("короткое слово с опечаткой не угадывается, ничего не находится без ошибки", async () => {
      seed();
      const r = await searchMarketItems({ search: "торх" }, { svc: as(svc), shown: two });
      expect(r).toMatchObject({ items: [], next: null, fuzzy: false });
    });

    it("скрытый магазин и клиент прежней платформы не находятся ни точно, ни с опечаткой", async () => {
      const t = (id: string, name: string, settings: TenantSettings) =>
        ({ id, name, vertical: "shop", settings }) as unknown as Tenant;
      const map = shownShops([
        t(BOT, "Сладкая лавка", OPEN),
        t("b2", "Розовый сад", { ...OPEN, slug: "flowers", served_by: "v1" }),
        t("b3", "Тайный сад", {
          ...OPEN,
          slug: "secret",
          marketplace: { listed: true, approved: true, hidden: true },
        }),
      ]);
      svc.tables.marketplace_items = [
        row(1, { name: "Медовик", search_text: "медовик" }),
        row(2, { bot_id: "b2", name: "Медовик розовый", search_text: "медовик розовый" }),
        row(3, { bot_id: "b3", name: "Медовик тайный", search_text: "медовик тайный" }),
      ];
      const shownMap = async () => map;
      for (const search of ["медовик", "медовк", "розовый", "сад"]) {
        const r = await searchMarketItems({ search }, { svc: as(svc), shown: shownMap });
        expect(r.items.every((i) => i.shopId === BOT)).toBe(true);
      }
    });

    it("постранично в режиме с опечатками: смещение и fuzzy продолжают поиск без дублей", async () => {
      const n = MARKET_ITEMS_PAGE + 5;
      svc.tables.marketplace_items = Array.from({ length: n }, (_, i) =>
        row(i + 1, { search_text: "клубничный торт" }),
      );
      const first = await searchMarketItems({ search: "клубничнй" }, { svc: as(svc), shown });
      expect(first.fuzzy).toBe(true);
      expect(first.items).toHaveLength(MARKET_ITEMS_PAGE);
      const second = await searchMarketItems(
        { search: "клубничнй", offset: first.next!, fuzzy: true },
        { svc: as(svc), shown },
      );
      expect(second.items).toHaveLength(5);
      expect(new Set([...first.items, ...second.items].map((i) => i.id)).size).toBe(n);
    });
  });

  it("сбой чтения — ошибка, а не «ничего не нашли»", async () => {
    svc.tables.marketplace_items = [row(1)];
    const broken = withBrokenReads(svc, ["marketplace_items"]);
    await expect(
      searchMarketItems({ search: "торт" }, { svc: as(broken), shown }),
    ).rejects.toThrow();
  });
});
