import { SITE_URL } from "@/app/landing/config";
import { SUPPORTED_LOCALES, type Locale } from "@/core/i18n/locale";

/**
 * SEO площадки (В10). В карту сайта идут только страницы, у которых есть что читать:
 * каталог магазинов, «Открыть свой магазин» и правила площадки. Фильтры, поиск товаров и постраничный
 * показ — те же страницы: canonical у них без параметров, кроме языка.
 */
export const MARKET_PAGES = ["/market", "/market/open", "/market/rules"] as const;
export type MarketPage = (typeof MARKET_PAGES)[number];

/** Адрес страницы на языке: русский — без параметра, как у главной. */
export function marketUrl(page: MarketPage, locale: Locale): string {
  return locale === "ru" ? `${SITE_URL}${page}` : `${SITE_URL}${page}?lang=${locale}`;
}

/**
 * Страницы площадки для карты сайта, на всех языках, без повторов. Пока на
 * площадке нет ни одного магазина, каталог — пустой список («магазинов нет»):
 * поиск считает такую страницу «ложной 404», поэтому в карту он не идёт.
 */
export function marketSitemapLocs(opts: { hasShops: boolean }): string[] {
  return MARKET_PAGES.filter((p) => opts.hasShops || p !== "/market").flatMap((p) =>
    SUPPORTED_LOCALES.map((l) => marketUrl(p, l)),
  );
}

/** Пустой каталог площадки не индексируется, ссылки с него — да. */
export function marketIndexRobots(shopsShown: number): { name: string; content: string }[] {
  return shopsShown === 0 ? [{ name: "robots", content: "noindex,follow" }] : [];
}

/** canonical, переводы страницы и x-default для `head`. */
export function marketHeadLinks(page: MarketPage, locale: Locale) {
  return [
    { rel: "canonical", href: marketUrl(page, locale) },
    ...SUPPORTED_LOCALES.map((l) => ({
      rel: "alternate",
      hrefLang: l,
      href: marketUrl(page, l),
    })),
    { rel: "alternate", hrefLang: "x-default", href: marketUrl(page, "ru") },
  ];
}
