import { describe, expect, it } from "vitest";
import {
  categoryCanonical,
  categoryIndexable,
  jsonLdScript,
  productCanonical,
  productJsonLd,
  shopCanonical,
  type SeoProduct,
} from "./seo";

const shop = { name: "Лавка", slug: "lavka", origin: "https://shop.kz" };
const base: SeoProduct = {
  id: "p1",
  name: "Пазл",
  description: "Развивающий <b>пазл</b>\n для детей",
  price: 4990,
  currency: "KZT",
  images: ["/api/img/b/x", "https://cdn.example/y.jpg", "//evil/z"],
  variants: [],
  inStock: true,
};

describe("canonical", () => {
  it("адреса как в карте сайта", () => {
    expect(shopCanonical("https://shop.kz/", "lavka")).toBe("https://shop.kz/s/lavka");
    expect(productCanonical("https://shop.kz", "lavka", "p1")).toBe("https://shop.kz/s/lavka/p/p1");
    expect(categoryCanonical("https://shop.kz", "lavka", "c 1")).toBe(
      "https://shop.kz/s/lavka/c/c%201",
    );
  });
});

describe("JSON-LD товара", () => {
  it("одна цена: Offer, наличие, абсолютные картинки, без оценки", () => {
    const ld = productJsonLd(base, shop, null);
    expect(ld).toMatchObject({
      "@type": "Product",
      name: "Пазл",
      description: "Развивающий пазл для детей",
      image: ["https://shop.kz/api/img/b/x", "https://cdn.example/y.jpg"],
      url: "https://shop.kz/s/lavka/p/p1",
      offers: {
        "@type": "Offer",
        price: "4990",
        priceCurrency: "KZT",
        availability: "https://schema.org/InStock",
      },
    });
    expect(ld).not.toHaveProperty("aggregateRating");
  });

  it("варианты: AggregateOffer от и до; нет в наличии", () => {
    const ld = productJsonLd(
      {
        ...base,
        inStock: false,
        variants: [
          { price: 7000, currency: "KZT" },
          { price: 3000.5, currency: "KZT" },
        ],
      },
      shop,
      null,
    );
    expect(ld.offers).toMatchObject({
      "@type": "AggregateOffer",
      lowPrice: "3000.5",
      highPrice: "7000",
      offerCount: 2,
      availability: "https://schema.org/OutOfStock",
    });
  });

  it("оценка — только когда есть одобренные отзывы", () => {
    expect(productJsonLd(base, shop, { avg: 4.7, count: 3 }).aggregateRating).toEqual({
      "@type": "AggregateRating",
      ratingValue: 4.7,
      reviewCount: 3,
      bestRating: 5,
      worstRating: 1,
    });
    expect(productJsonLd(base, shop, { avg: 0, count: 0 })).not.toHaveProperty("aggregateRating");
  });

  it("Review (Л4): с оценкой — до пяти отзывов в формате schema.org; без оценки и без отзывов — нет", () => {
    const reviews = [
      { author: "Анна К.", rating: 5, text: "Отлично <b>очень</b>", date: "2026-09-20T10:00:00Z" },
      { author: "Олег", rating: 3, text: null, date: "2026-09-21T10:00:00Z" },
    ];
    const ld = productJsonLd(base, shop, { avg: 4, count: 2 }, reviews);
    expect(ld.review).toEqual([
      {
        "@type": "Review",
        author: { "@type": "Person", name: "Анна К." },
        reviewRating: { "@type": "Rating", ratingValue: 5, bestRating: 5, worstRating: 1 },
        reviewBody: "Отлично очень",
        datePublished: "2026-09-20",
      },
      {
        "@type": "Review",
        author: { "@type": "Person", name: "Олег" },
        reviewRating: { "@type": "Rating", ratingValue: 3, bestRating: 5, worstRating: 1 },
        datePublished: "2026-09-21",
      },
    ]);
    expect(productJsonLd(base, shop, null, reviews)).not.toHaveProperty("review");
    expect(productJsonLd(base, shop, { avg: 4, count: 2 }, [])).not.toHaveProperty("review");
    expect(() => JSON.parse(jsonLdScript(ld).children)).not.toThrow();
  });

  it("название с </script> не закрывает тег, JSON разбирается обратно", () => {
    const s = jsonLdScript(productJsonLd({ ...base, name: "A</script><script>x()" }, shop, null));
    expect(s.type).toBe("application/ld+json");
    expect(s.children).not.toMatch(/<|>/);
    expect(JSON.parse(s.children).name).toBe("A</script><script>x()");
  });
});

describe("категория для поиска", () => {
  it("пустая — не в индекс; неизвестное число (сбой загрузки) не прячем", () => {
    expect(categoryIndexable(0)).toBe(false);
    expect(categoryIndexable(5)).toBe(true);
    expect(categoryIndexable(null)).toBe(true);
  });
});
