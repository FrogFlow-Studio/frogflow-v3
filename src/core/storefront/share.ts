/**
 * Превью ссылок на витрину (Open Graph для Telegram, WhatsApp, Instagram) и
 * установка витрины на телефон (манифест PWA). Чистый модуль: его читают
 * заголовки страниц (head) в браузере и на сервере.
 *
 * Мессенджеры не знают адреса страницы, поэтому картинка и адрес в тегах —
 * только абсолютные ссылки от адреса платформы (APP_URL).
 */

export type ShareShop = {
  slug: string;
  name: string;
  tagline: string | null;
  accent: string | null;
  /** Адрес платформы без «/» в конце: https://www.frogflow.tech. */
  origin: string;
  /** Картинка витрины (путь /api/img/… или абсолютная ссылка); нет — без og:image. */
  cover: string | null;
};

export type ShareProduct = {
  id: string;
  name: string;
  description: string;
  images: string[];
};

type Meta =
  { title: string } | { name: string; content: string } | { property: string; content: string };

/** Цвет платформы, если продавец не выбрал свой. */
export const DEFAULT_THEME = "#16a34a";

export function absoluteUrl(origin: string, path: string | null | undefined): string | null {
  if (!path) return null;
  if (/^https:\/\//i.test(path)) return path;
  if (!path.startsWith("/") || path.startsWith("//")) return null;
  return `${origin.replace(/\/+$/, "")}${path}`;
}

/** Описание для превью: без тегов и лишних пробелов, до 200 знаков по границе слова. */
export function shareText(raw: string | null | undefined, max = 200): string {
  const s = (raw ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

export const shopUrl = (shop: Pick<ShareShop, "origin" | "slug">) =>
  `${shop.origin.replace(/\/+$/, "")}/s/${shop.slug}`;

function card(o: {
  title: string;
  description: string;
  url: string;
  image: string | null;
  imageAlt: string;
  siteName: string;
  type: "website" | "product";
}): Meta[] {
  return [
    { title: o.title },
    ...(o.description ? [{ name: "description", content: o.description }] : []),
    { property: "og:type", content: o.type },
    { property: "og:site_name", content: o.siteName },
    { property: "og:title", content: o.title },
    ...(o.description ? [{ property: "og:description", content: o.description }] : []),
    { property: "og:url", content: o.url },
    ...(o.image
      ? [
          { property: "og:image", content: o.image },
          { property: "og:image:alt", content: o.imageAlt },
        ]
      : []),
    { name: "twitter:card", content: o.image ? "summary_large_image" : "summary" },
  ];
}

/** Теги главной витрины и «установки на телефон» (цвет, имя на иконке). */
export function shopMeta(shop: ShareShop): Meta[] {
  return [
    ...card({
      title: shop.name,
      description: shareText(shop.tagline),
      url: shopUrl(shop),
      image: absoluteUrl(shop.origin, shop.cover),
      imageAlt: shop.name,
      siteName: shop.name,
      type: "website",
    }),
    { name: "theme-color", content: shop.accent ?? DEFAULT_THEME },
    { name: "apple-mobile-web-app-capable", content: "yes" },
    { name: "mobile-web-app-capable", content: "yes" },
    { name: "apple-mobile-web-app-title", content: shortName(shop.name) },
  ];
}

/** Теги страницы товара; картинка — первое фото товара, иначе картинка витрины. */
export function productMeta(p: ShareProduct, shop: ShareShop | null): Meta[] {
  const origin = shop?.origin ?? "";
  const url = shop ? `${shopUrl(shop)}/p/${p.id}` : "";
  return card({
    title: shop ? `${p.name} — ${shop.name}` : p.name,
    description: shareText(p.description),
    url,
    image: origin ? absoluteUrl(origin, p.images[0] ?? shop?.cover) : null,
    imageAlt: p.name,
    siteName: shop?.name ?? p.name,
    type: "product",
  }).filter((m) => !("property" in m && m.property === "og:url" && !url));
}

/** Имя под иконкой на телефоне: до 12 знаков, по границе слова, если получится. */
export function shortName(name: string): string {
  const s = name.trim();
  if (s.length <= 12) return s;
  const first = s.split(/\s+/)[0]!;
  return first.length <= 12 ? first : `${s.slice(0, 11)}…`;
}

export const ICON_SIZES = [192, 512] as const;
export type IconSize = (typeof ICON_SIZES)[number] | 180;

/** Ссылки в <head>: манифест и иконка для iPhone. */
export function shopLinks(slug: string) {
  return [
    { rel: "manifest", href: `/s/${slug}/manifest.webmanifest` },
    { rel: "apple-touch-icon", href: `/s/${slug}/icon/180` },
  ];
}

/** Манифест витрины: открывается отдельным окном, как приложение. */
export function shopManifest(shop: Pick<ShareShop, "slug" | "name" | "tagline" | "accent">) {
  const start = `/s/${shop.slug}`;
  const color = shop.accent ?? DEFAULT_THEME;
  return {
    id: start,
    name: shop.name,
    short_name: shortName(shop.name),
    description: shareText(shop.tagline, 300) || undefined,
    start_url: start,
    scope: start,
    display: "standalone",
    background_color: "#ffffff",
    theme_color: color,
    icons: ICON_SIZES.map((size) => ({
      src: `/s/${shop.slug}/icon/${size}`,
      sizes: `${size}x${size}`,
      type: "image/png",
      purpose: "any maskable",
    })),
  };
}
