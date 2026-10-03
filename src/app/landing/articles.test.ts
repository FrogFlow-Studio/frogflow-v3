import { describe, expect, it } from "vitest";
import { SUPPORTED_LOCALES } from "@/core/i18n/locale";
import { ARTICLES, ARTICLE_SLUGS, articleSitemapLocs, articleUrl, isArticleSlug } from "./articles";

describe("SEO-статьи платформы", () => {
  it("каждая статья есть на всех четырёх языках и заполнена целиком", () => {
    for (const slug of ARTICLE_SLUGS)
      for (const l of SUPPORTED_LOCALES) {
        const a = ARTICLES[slug][l];
        for (const f of [a.link, a.title, a.description, a.h1, a.lead, a.cta])
          expect(f.trim().length, `${slug}/${l}`).toBeGreaterThan(5);
        expect(a.sections.length, `${slug}/${l}`).toBeGreaterThanOrEqual(4);
        for (const s of a.sections) {
          expect(s.h.trim()).not.toBe("");
          expect(s.p.length).toBeGreaterThan(0);
        }
      }
  });

  it("структура одинакова на всех языках: те же разделы и абзацы", () => {
    for (const slug of ARTICLE_SLUGS) {
      const shape = (l: (typeof SUPPORTED_LOCALES)[number]) =>
        ARTICLES[slug][l].sections.map((s) => s.p.length);
      for (const l of SUPPORTED_LOCALES) expect(shape(l), `${slug}/${l}`).toEqual(shape("ru"));
    }
  });

  it("заголовки и описания не повторяются между страницами и языками", () => {
    const all = ARTICLE_SLUGS.flatMap((s) => SUPPORTED_LOCALES.map((l) => ARTICLES[s][l]));
    expect(new Set(all.map((a) => a.title)).size).toBe(all.length);
    expect(new Set(all.map((a) => a.description)).size).toBe(all.length);
  });

  it("описание влезает в сниппет поиска", () => {
    for (const slug of ARTICLE_SLUGS)
      for (const l of SUPPORTED_LOCALES)
        expect(ARTICLES[slug][l].description.length, `${slug}/${l}`).toBeLessThanOrEqual(240);
  });

  it("цен нет в текстах: они на главной из реестра планов", () => {
    const text = JSON.stringify(ARTICLES);
    expect(text).not.toMatch(/₸|₽|\d\s?(?:тг|тенге|KZT)/i);
  });

  it("адреса: русский без параметра, остальные с ?lang=", () => {
    expect(articleUrl("telegram-sales-bot", "ru")).toBe(
      "https://www.frogflow.tech/blog/telegram-sales-bot",
    );
    expect(articleUrl("instagram-direct-sales", "kk")).toBe(
      "https://www.frogflow.tech/blog/instagram-direct-sales?lang=kk",
    );
    expect(isArticleSlug("online-school-bot")).toBe(true);
    expect(isArticleSlug("nope")).toBe(false);
  });

  it("в карту сайта входит каждая статья на каждом языке, без повторов", () => {
    const locs = articleSitemapLocs();
    expect(locs).toHaveLength(ARTICLE_SLUGS.length * SUPPORTED_LOCALES.length);
    expect(new Set(locs).size).toBe(locs.length);
  });
});
