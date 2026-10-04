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
    const r = await syncMarketplaceItems(ctxFor(), as(svc));
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

  it("сбой чтения — ошибка, а не «ничего не нашли»", async () => {
    svc.tables.marketplace_items = [row(1)];
    const broken = withBrokenReads(svc, ["marketplace_items"]);
    await expect(
      searchMarketItems({ search: "торт" }, { svc: as(broken), shown }),
    ).rejects.toThrow();
  });
});
