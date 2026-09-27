/**
 * Разметка витрины для поисковиков: canonical и JSON-LD товара
 * (https://schema.org/Product). Чистый модуль: его читают заголовки
 * страниц (head) на сервере и в браузере.
 *
 * Ссылки — абсолютные от адреса canonical (свой домен магазина или адрес
 * платформы). Оценка — только из одобренных продавцом отзывов, как их
 * видит покупатель на странице товара.
 */
import { absoluteUrl, shareText } from "./share";

export type SeoProduct = {
  id: string;
  name: string;
  description: string;
  price: number;
  currency: string;
  images: string[];
  variants: Array<{ price: number; currency: string }>;
  inStock: boolean;
};

export type SeoRating = { avg: number; count: number } | null;

export const shopCanonical = (origin: string, slug: string) =>
  `${origin.replace(/\/+$/, "")}/s/${slug}`;

export const productCanonical = (origin: string, slug: string, id: string) =>
  `${shopCanonical(origin, slug)}/p/${encodeURIComponent(id)}`;

/** Страница категории — тот же адрес, что в карте сайта (core/storefront/sitemap). */
export const categoryCanonical = (origin: string, slug: string, id: string) =>
  `${shopCanonical(origin, slug)}?category=${encodeURIComponent(id)}`;

/** Вторая и дальше страницы каталога — свои адреса: на них другие товары. */
export const pagedCanonical = (url: string, page: number | undefined) =>
  page && page > 1 ? `${url}${url.includes("?") ? "&" : "?"}page=${page}` : url;

export const canonicalLink = (href: string) => ({ rel: "canonical", href });

/** Цена для schema.org: число с точкой, без пробелов и знака валюты. */
const price = (n: number) => String(Math.round(n * 100) / 100);

export function productJsonLd(
  p: SeoProduct,
  shop: { name: string; slug: string; origin: string },
  rating: SeoRating,
): Record<string, unknown> {
  const url = productCanonical(shop.origin, shop.slug, p.id);
  const availability = `https://schema.org/${p.inStock ? "InStock" : "OutOfStock"}`;
  const seller = { "@type": "Organization", name: shop.name };
  const prices = p.variants.length ? p.variants : [{ price: p.price, currency: p.currency }];
  const amounts = prices.map((v) => v.price);
  const currency = prices[0]!.currency;
  const offers =
    prices.length > 1
      ? {
          "@type": "AggregateOffer",
          priceCurrency: currency,
          lowPrice: price(Math.min(...amounts)),
          highPrice: price(Math.max(...amounts)),
          offerCount: prices.length,
          availability,
          url,
          seller,
        }
      : {
          "@type": "Offer",
          priceCurrency: currency,
          price: price(amounts[0]!),
          availability,
          url,
          seller,
        };
  const images = p.images
    .map((i) => absoluteUrl(shop.origin, i))
    .filter((i): i is string => Boolean(i));
  const description = shareText(p.description, 500);
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: p.name,
    ...(description ? { description } : {}),
    ...(images.length ? { image: images } : {}),
    sku: p.id,
    url,
    brand: { "@type": "Brand", name: shop.name },
    offers,
    ...(rating && rating.count > 0
      ? {
          aggregateRating: {
            "@type": "AggregateRating",
            ratingValue: rating.avg,
            reviewCount: rating.count,
            bestRating: 5,
            worstRating: 1,
          },
        }
      : {}),
  };
}

/**
 * <script type="application/ld+json"> для head().scripts. Содержимое идёт в
 * страницу как есть, поэтому «<» (и «</script>» в названии товара)
 * экранируется, а также разрывы строк U+2028/U+2029.
 */
export function jsonLdScript(data: Record<string, unknown>) {
  return {
    type: "application/ld+json",
    children: JSON.stringify(data)
      .replace(/</g, "\\u003c")
      .replace(/>/g, "\\u003e")
      .replace(/&/g, "\\u0026")
      .replace(/\u2028/g, "\\u2028")
      .replace(/\u2029/g, "\\u2029"),
  };
}
