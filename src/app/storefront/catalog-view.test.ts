import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/storefront/catalog.functions", () => ({ storeCatalogPageFn: vi.fn() }));

const { catalogHead } = await import("./catalog-view");

const CAT = "11111111-1111-4111-8111-111111111111";
const matches = [
  {
    routeId: "/s/$slug",
    loaderData: {
      slug: "demo",
      name: "Лавка",
      tagline: null,
      locale: "ru",
      categories: [{ id: CAT, name: "Торты", parent_id: null }],
      share: { origin: "https://shop.kz", canonical: "https://shop.kz", cover: null },
    },
  },
];
const robots = (h: ReturnType<typeof catalogHead>) =>
  (h.meta as Array<Record<string, string>> | undefined)?.find((m) => m.name === "robots");

describe("заголовки страницы категории", () => {
  it("canonical — адрес /c/<id>, разметка крошек на месте", () => {
    const h = catalogHead(matches, { category: CAT }, 3);
    expect(h.links).toEqual([{ rel: "canonical", href: `https://shop.kz/s/demo/c/${CAT}` }]);
    expect(h.scripts).toHaveLength(1);
    expect(robots(h)).toBeUndefined();
  });
  it("пустая категория — noindex, но canonical сохраняется", () => {
    const h = catalogHead(matches, { category: CAT }, 0);
    expect(robots(h)).toEqual({ name: "robots", content: "noindex,follow" });
    expect(h.links).toHaveLength(1);
  });
  it("фильтры в адресе не меняют canonical", () => {
    const h = catalogHead(matches, { category: CAT, stock: 1, min: 100 }, 2);
    expect(h.links).toEqual([{ rel: "canonical", href: `https://shop.kz/s/demo/c/${CAT}` }]);
  });
  it("главная каталога — canonical магазина", () => {
    expect(catalogHead(matches, {}, 4).links).toEqual([
      { rel: "canonical", href: "https://shop.kz/s/demo" },
    ]);
  });
});
