import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Tenant } from "@/core/tenant/types";
import { platformSitemapLocs } from "@/app/storefront/sitemap.server";
import { robotsTxt, sitemapIndexXml, sitemapXml, storefrontSitemap } from "./sitemap";

const file = [{ language: "ru", file_path: "t/a.pdf", file_name: "a.pdf", sort_order: 0 }];
const product = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  name: id,
  is_active: true,
  sort_order: 0,
  category_ids: [],
  fulfillment_kind: "digital",
  product_material_files: file,
  ...extra,
});

function ctxWith(opts: { legal?: boolean; settings?: Record<string, string> } = {}) {
  const db = fakeDb();
  db.tables.categories = [
    { id: "c-open", name: "Открытая", parent_id: null, is_visible: true },
    { id: "c-hidden", name: "Скрытая", parent_id: null, is_visible: false },
  ];
  db.tables.products = [
    product("p-plain"),
    product("p-open", { category_ids: ["c-open"] }),
    product("p-hidden", { category_ids: ["c-hidden"] }),
    product("p-off", { is_active: false }),
    product("p-nofile", { product_material_files: [] }),
    product("p-cake", { fulfillment_kind: "physical", product_material_files: [] }),
  ];
  db.tables.app_settings = Object.entries(opts.settings ?? {}).map(([key, value]) => ({
    key,
    value,
  }));
  const ctx = {
    db,
    tenant: { id: "t1", modules: { legal_docs: opts.legal ?? false }, settings: {} },
  } as unknown as TenantContext;
  return ctx;
}

const BASE = "https://www.frogflow.tech/s/demo";

describe("карта сайта витрины", () => {
  it("только то, что покупатель видит в каталоге", async () => {
    const locs = (await storefrontSitemap(ctxWith(), BASE)).map((e) => e.loc);
    expect(locs.slice(0, 2)).toEqual([BASE, `${BASE}/c/c-open`]);
    expect(locs.slice(2).sort()).toEqual([
      `${BASE}/p/p-cake`,
      `${BASE}/p/p-open`,
      `${BASE}/p/p-plain`,
    ]);
  });

  it("пустая категория в карту не идёт, товар подкатегории наполняет и родителя", async () => {
    const ctx = ctxWith();
    const tables = (ctx.db as unknown as ReturnType<typeof fakeDb>).tables;
    tables.categories!.push(
      { id: "c-empty", name: "Пустая", parent_id: null, is_visible: true },
      { id: "c-parent", name: "Раздел", parent_id: null, is_visible: true },
      { id: "c-child", name: "Подраздел", parent_id: "c-parent", is_visible: true },
      { id: "c-child-empty", name: "Пустой подраздел", parent_id: "c-parent", is_visible: true },
    );
    tables.products!.push(product("p-child", { category_ids: ["c-child"] }));
    const locs = (await storefrontSitemap(ctx, BASE)).map((e) => e.loc);
    expect(locs).toContain(`${BASE}/c/c-parent`);
    expect(locs).toContain(`${BASE}/c/c-child`);
    expect(locs).not.toContain(`${BASE}/c/c-empty`);
    expect(locs).not.toContain(`${BASE}/c/c-child-empty`);
    expect(locs).not.toContain(`${BASE}/c/c-hidden`);
  });

  it("юридические страницы — только опубликованные и при модуле", async () => {
    const settings = { legal_offer: "Оферта", legal_privacy: "  " };
    const off = await storefrontSitemap(ctxWith({ settings }), BASE);
    expect(off.some((e) => e.loc.includes("/legal/"))).toBe(false);
    const on = await storefrontSitemap(ctxWith({ legal: true, settings }), BASE);
    expect(on.filter((e) => e.loc.includes("/legal/")).map((e) => e.loc)).toEqual([
      `${BASE}/legal/offer`,
    ]);
  });

  it("XML по протоколу, спецсимволы экранированы", () => {
    const xml = sitemapXml([{ loc: `${BASE}?stock=1&b`, priority: 0.6 }]);
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(xml).toContain("<loc>https://www.frogflow.tech/s/demo?stock=1&amp;b</loc>");
    expect(xml).toContain("<priority>0.6</priority>");
    expect(sitemapIndexXml([`${BASE}/sitemap.xml`])).toContain(
      `<sitemap><loc>${BASE}/sitemap.xml</loc></sitemap>`,
    );
  });

  it("robots.txt закрывает панели, API и корзину и указывает карту", () => {
    const txt = robotsTxt("https://www.frogflow.tech/sitemap.xml");
    for (const line of [
      "Disallow: /admin",
      "Disallow: /operator",
      "Disallow: /api/",
      "Disallow: /s/*/cart",
    ])
      expect(txt).toContain(line);
    expect(txt).toContain("Sitemap: https://www.frogflow.tech/sitemap.xml");
  });
});

describe("индекс карт на общем адресе", () => {
  const APP = "https://www.frogflow.tech";
  const shop = (slug: string, extra: Partial<Tenant> & { settings?: object } = {}) =>
    ({
      id: slug,
      archived: false,
      modules: { shop: true, web_storefront: true },
      ...extra,
      settings: { slug, served_by: "v2", ...(extra.settings ?? {}) },
    }) as unknown as Tenant;

  it("только открытые витрины v2 без своего домена", () => {
    const locs = platformSitemapLocs(
      [
        shop("open"),
        shop("miniapp", { modules: { shop: true, telegram_mini_app: true } } as never),
        shop("v1", { settings: { served_by: "v1" } }),
        shop("archived", { archived: true }),
        shop("nomodule", { modules: { shop: true } } as never),
        shop("own", { settings: { hosts: ["shop.example.kz"] } }),
      ],
      APP,
    );
    expect(locs).toEqual([`${APP}/s/open/sitemap.xml`, `${APP}/s/miniapp/sitemap.xml`]);
  });
});
