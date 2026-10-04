import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { visibleCategoryIds } from "./categories";
import { storefrontSitemap } from "./sitemap";
import {
  breadcrumbJsonLd,
  jsonLdScript,
  productCanonical,
  storefrontCrumbs,
  shopCanonical,
} from "./seo";

const shop = { name: "Лавка", slug: "lavka", origin: "https://shop.kz" };
const cats = [
  { id: "toys", name: "Игрушки", parent_id: null },
  { id: "puzzles", name: "Пазлы", parent_id: "toys" },
  { id: "wood", name: "Деревянные", parent_id: "puzzles" },
  { id: "books", name: "Книги", parent_id: null },
];
const leaf = { name: "Пазл «Лес»", url: productCanonical(shop.origin, shop.slug, "p1") };

describe("хлебные крошки витрины", () => {
  it("товар во вложенной категории: магазин › корень › … › товар, звенья в порядке пути", () => {
    const c = storefrontCrumbs(shop, cats, ["wood"], leaf);
    expect(c.map((x) => x.name)).toEqual(["Лавка", "Игрушки", "Пазлы", "Деревянные", "Пазл «Лес»"]);
    expect(c.map((x) => x.categoryId)).toEqual([null, "toys", "puzzles", "wood", null]);
  });

  it("страница категории: последнее звено — сама категория", () => {
    const c = storefrontCrumbs(shop, cats, ["puzzles"]);
    expect(c.map((x) => x.name)).toEqual(["Лавка", "Игрушки", "Пазлы"]);
  });

  it("товар без категории и с удалённой/скрытой категорией — только магазин › товар", () => {
    expect(storefrontCrumbs(shop, cats, [], leaf).map((x) => x.name)).toEqual([
      "Лавка",
      "Пазл «Лес»",
    ]);
    expect(storefrontCrumbs(shop, cats, ["gone"], leaf)).toHaveLength(2);
  });

  it("несколько категорий: берётся первая видимая; скрытая в путь не попадает", () => {
    const withHidden = [...cats, { id: "secret", name: "Секрет", parent_id: null }];
    const visibleOnly = withHidden.filter((c) => c.id !== "secret");
    expect(
      storefrontCrumbs(shop, visibleOnly, ["secret", "books"], leaf).map((x) => x.name),
    ).toEqual(["Лавка", "Книги", "Пазл «Лес»"]);
  });

  it("цикл в parent_id не зависает", () => {
    const loop = [
      { id: "a", name: "A", parent_id: "b" },
      { id: "b", name: "B", parent_id: "a" },
    ];
    expect(storefrontCrumbs(shop, loop, ["a"]).map((x) => x.name)).toEqual(["Лавка", "B", "A"]);
  });

  it("BreadcrumbList: позиции с 1, адреса — те же canonical, что в карте сайта", async () => {
    const db = fakeDb();
    db.tables.categories = cats.map((c) => ({ ...c, is_visible: true, sort_order: 0 }));
    db.tables.products = [
      {
        id: "p1",
        name: "Пазл",
        is_active: true,
        sort_order: 0,
        category_ids: ["wood"],
        fulfillment_kind: "physical",
        product_material_files: [],
      },
    ];
    db.tables.app_settings = [];
    const ctx = {
      db,
      tenant: { id: "t1", modules: { legal_docs: false }, settings: {} },
    } as unknown as TenantContext;
    const base = shopCanonical(shop.origin, shop.slug);
    const locs = new Set((await storefrontSitemap(ctx, base)).map((e) => e.loc));
    const visible = visibleCategoryIds(cats.map((c) => ({ ...c, is_visible: true })));
    expect(visible.has("wood")).toBe(true);

    const ld = breadcrumbJsonLd(storefrontCrumbs(shop, cats, ["wood"], leaf)) as {
      "@type": string;
      itemListElement: Array<{ position: number; name: string; item: string }>;
    };
    expect(ld["@type"]).toBe("BreadcrumbList");
    expect(ld.itemListElement.map((x) => x.position)).toEqual([1, 2, 3, 4, 5]);
    // Каждое звено, кроме главной, есть в карте сайта под тем же адресом.
    for (const el of ld.itemListElement.slice(1)) expect(locs.has(el.item)).toBe(true);
    expect(ld.itemListElement[0]!.item).toBe(base);
  });

  it("в страницу разметка уходит экранированной", () => {
    const s = jsonLdScript(
      breadcrumbJsonLd(storefrontCrumbs(shop, cats, [], { name: "</script><b>", url: "u" })),
    );
    expect(s.children).not.toContain("</script>");
  });
});
