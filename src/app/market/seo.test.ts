import { describe, expect, it } from "vitest";
import { robotsTxt } from "@/core/storefront/sitemap";
import { MARKET_PAGES, marketHeadLinks, marketSitemapLocs, marketUrl } from "./seo";

describe("SEO площадки", () => {
  it("карта: каталог, «Открыть магазин» и правила на четырёх языках, без повторов и без поиска", () => {
    const locs = marketSitemapLocs();
    expect(locs).toHaveLength(MARKET_PAGES.length * 4);
    expect(new Set(locs).size).toBe(locs.length);
    expect(locs).toContain("https://www.frogflow.tech/market");
    expect(locs).toContain("https://www.frogflow.tech/market/open?lang=uz");
    expect(locs).toContain("https://www.frogflow.tech/market/rules?lang=kk");
    expect(locs.some((l) => l.includes("search"))).toBe(false);
  });

  it("canonical без фильтров и номера страницы, язык — свой адрес с переводами", () => {
    const links = marketHeadLinks("/market", "kk");
    expect(links[0]).toEqual({
      rel: "canonical",
      href: "https://www.frogflow.tech/market?lang=kk",
    });
    expect(links.filter((l) => l.rel === "alternate").map((l) => l.hrefLang)).toEqual([
      "ru",
      "kk",
      "en",
      "uz",
      "x-default",
    ]);
    expect(marketUrl("/market", "ru")).toBe("https://www.frogflow.tech/market");
  });

  it("robots закрывает поиск товаров (он и сам noindex), каталог не закрывает", () => {
    const txt = robotsTxt("https://www.frogflow.tech/sitemap.xml");
    expect(txt).toContain("Disallow: /market/search");
    expect(txt).not.toMatch(/Disallow: \/market\s/);
  });
});
