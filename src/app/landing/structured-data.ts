/**
 * Разметка главной для поисковиков (https://schema.org): кто мы
 * (Organization) и что продаём (SoftwareApplication с ценами тарифов из
 * реестра планов). По ней Google и Яндекс показывают название, цену «от»
 * и контакты прямо в выдаче.
 */
import { MONTHLY_PRICE, PLAN_TIERS } from "@/core/plans/registry";
import { CONTACTS, SITE_URL } from "./config";

export function landingJsonLd(o: {
  url: string;
  name: string;
  description: string;
  locale: string;
}): Record<string, unknown> {
  const prices = PLAN_TIERS.map((t) => MONTHLY_PRICE[t]);
  const sameAs = [
    CONTACTS.telegram ? `https://t.me/${CONTACTS.telegram}` : null,
    CONTACTS.whatsapp ? `https://wa.me/${CONTACTS.whatsapp}` : null,
  ].filter((v): v is string => v !== null);
  const orgId = `${SITE_URL}/#organization`;
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": orgId,
        name: "FrogFlow",
        url: `${SITE_URL}/`,
        areaServed: "KZ",
        ...(sameAs.length ? { sameAs } : {}),
      },
      {
        "@type": "SoftwareApplication",
        name: o.name,
        description: o.description,
        url: o.url,
        inLanguage: o.locale,
        applicationCategory: "BusinessApplication",
        operatingSystem: "Web, Telegram, WhatsApp, Instagram",
        publisher: { "@id": orgId },
        offers: {
          "@type": "AggregateOffer",
          priceCurrency: "KZT",
          lowPrice: Math.min(...prices),
          highPrice: Math.max(...prices),
          offerCount: prices.length,
        },
      },
    ],
  };
}
