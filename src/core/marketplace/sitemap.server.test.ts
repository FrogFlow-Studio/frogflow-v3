import { beforeEach, describe, expect, it } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import { withBrokenReads } from "../../../tests/broken-db";
import type { Db } from "@/core/db/client.server";
import type { Tenant, TenantSettings } from "@/core/tenant/types";
import { shownShops } from "./items.server";
import { SITEMAP_MARKET_MAX, marketSitemap, marketSitemapXml } from "./sitemap.server";

/** Карта сайта площадки (Л4): авторы и товары только видимых и только v2-магазинов. */
let svc: FakeDb;
const as = (d: FakeDb) => d as unknown as Db;
const BASE = "https://www.frogflow.tech";
const OPEN: TenantSettings = {
  served_by: "v2",
  slug: "cakes",
  marketplace: { listed: true, approved: true },
};
const t = (id: string, settings: TenantSettings) =>
  ({
    id,
    name: id,
    vertical: "shop",
    modules: { shop: true, web_storefront: true },
    settings,
  }) as unknown as Tenant;
const item = (bot: string, n: number) => ({
  bot_id: bot,
  product_id: `p${String(n).padStart(5, "0")}`,
  name: `Товар ${n}`,
  search_text: "",
  price: 1,
  currency: "KZT",
  image: null,
  updated_at: "2026-10-05T10:00:00Z",
});

beforeEach(() => {
  svc = fakeDb();
});

describe("карта площадки", () => {
  const shops = shownShops([
    t("b1", OPEN),
    t("b2", { ...OPEN, slug: "v1shop", served_by: "v1" }),
    t("b3", {
      ...OPEN,
      slug: "secret",
      marketplace: { listed: true, approved: true, hidden: true },
    }),
    t("b4", { ...OPEN, slug: "noconsent", marketplace: { listed: false } }),
  ]);

  it("авторы и товары только показываемого магазина; v1, скрытый и без согласия — нет", async () => {
    svc.tables.marketplace_items = [item("b1", 1), item("b2", 2), item("b3", 3), item("b4", 4)];
    const locs = (await marketSitemap(shops, BASE, as(svc))).map((e) => e.loc);
    expect(locs).toEqual([`${BASE}/s/cakes`, `${BASE}/s/cakes/p/p00001`]);
  });

  it("больше тысячи товаров — постранично, без потерь и повторов", async () => {
    svc.tables.marketplace_items = Array.from({ length: 2300 }, (_, i) => item("b1", i + 1));
    const locs = (await marketSitemap(shops, BASE, as(svc))).map((e) => e.loc);
    expect(locs).toHaveLength(2301);
    expect(new Set(locs).size).toBe(2301);
    expect(2301).toBeLessThan(SITEMAP_MARKET_MAX);
  });

  it("XML: адреса экранируются, формат карты", async () => {
    svc.tables.marketplace_items = [item("b1", 1)];
    const xml = await marketSitemapXml(shops, BASE, as(svc));
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(xml).toContain(`<loc>${BASE}/s/cakes/p/p00001</loc>`);
  });

  it("сбой чтения снимка — ошибка, а не «товаров нет»", async () => {
    svc.tables.marketplace_items = [item("b1", 1)];
    await expect(
      marketSitemap(shops, BASE, as(withBrokenReads(svc, ["marketplace_items"]))),
    ).rejects.toThrow();
  });
});
