import { absoluteUrl } from "./share";

/**
 * Страница «О магазине» (В4): то, что продавец сам рассказал о себе — описание,
 * телефон, адрес, часы работы, условия доставки и оплаты. Хранится в
 * `bots.settings.storefront_about`. Пока ничего не заполнено, страницы нет.
 */
export const ABOUT_LIMITS = {
  description: 1500,
  phone: 40,
  address: 200,
  hours: 200,
  delivery: 600,
  payment: 600,
} as const;

export type StoreAbout = {
  description: string;
  phone: string;
  address: string;
  hours: string;
  delivery: string;
  payment: string;
};

export const EMPTY_ABOUT: StoreAbout = {
  description: "",
  phone: "",
  address: "",
  hours: "",
  delivery: "",
  payment: "",
};

const clean = (v: unknown, max: number): string =>
  typeof v === "string"
    ? v
        .replace(/\r\n?/g, "\n")
        .replace(/[ \t]+/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .trim()
        .slice(0, max)
    : "";

export function parseAbout(raw: unknown): StoreAbout {
  const r =
    raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return {
    description: clean(r.description, ABOUT_LIMITS.description),
    phone: clean(r.phone, ABOUT_LIMITS.phone).replace(/\n/g, " "),
    address: clean(r.address, ABOUT_LIMITS.address).replace(/\n/g, " "),
    hours: clean(r.hours, ABOUT_LIMITS.hours).replace(/\n/g, " "),
    delivery: clean(r.delivery, ABOUT_LIMITS.delivery),
    payment: clean(r.payment, ABOUT_LIMITS.payment),
  };
}

/** Есть ли что показать: страница и ссылка на неё появляются только тогда. */
export const aboutFilled = (a: StoreAbout): boolean => Object.values(a).some((v) => v !== "");

export const aboutCanonical = (origin: string, slug: string) =>
  `${origin.replace(/\/+$/, "")}/s/${slug}/about`;

/**
 * https://schema.org/LocalBusiness, если указан адрес, иначе Organization. Только
 * то, что продавец указал сам; ссылки на мессенджеры — из `links` (https).
 */
export function aboutJsonLd(
  shop: { name: string; slug: string; origin: string; cover: string | null },
  a: StoreAbout,
  links: readonly string[],
): Record<string, unknown> {
  const url = `${shop.origin.replace(/\/+$/, "")}/s/${shop.slug}`;
  const out: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": a.address ? "LocalBusiness" : "Organization",
    name: shop.name,
    url,
  };
  if (a.description) out.description = a.description.slice(0, 300);
  if (a.phone) out.telephone = a.phone;
  if (a.address) out.address = { "@type": "PostalAddress", streetAddress: a.address };
  if (a.hours) out.openingHours = a.hours;
  const image = absoluteUrl(shop.origin, shop.cover);
  if (image) out.image = image;
  const same = links.filter((l) => /^https:\/\//i.test(l));
  if (same.length) out.sameAs = same;
  return out;
}
