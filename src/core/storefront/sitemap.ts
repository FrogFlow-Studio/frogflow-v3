/**
 * Карта сайта витрины (https://www.sitemaps.org/protocol.html): главная
 * магазина, видимые категории, товары, которые покупатель видит в каталоге,
 * и опубликованные юридические страницы. Правила видимости — те же, что у
 * каталога (core/storefront/catalog): активный товар, видимая категория,
 * цифровой — с файлами. Ничего, чего нет на витрине, в карту не попадает.
 *
 * Общий адрес платформы отдаёт индекс карт всех открытых витрин; магазин со
 * своим доменом — свою карту через robots.txt своего домена (карта может
 * ссылаться только на свой хост).
 */
import type { TenantContext } from "@/core/tenant/resolve.server";
import { listAllCategories } from "@/core/catalog/admin";
import { PRODUCT_SELECT, type Product } from "@/core/catalog/catalog";
import { productSellable } from "@/core/catalog/materials";
import { getSettings } from "@/core/settings/settings";
import { productOnStorefront, visibleCategoryIds } from "./categories";

/** Протокол разрешает 50 000 адресов в одной карте; с запасом. */
export const SITEMAP_MAX_PRODUCTS = 10_000;

const LEGAL_DOCS = ["offer", "privacy", "requisites", "about"] as const;

export type SitemapEntry = { loc: string; priority?: number };

/** Адреса витрины магазина; `base` — `https://host/s/<slug>` без «/» в конце. */
export async function storefrontSitemap(ctx: TenantContext, base: string): Promise<SitemapEntry[]> {
  const [products, cats, legal] = await Promise.all([
    ctx.db
      .from("products")
      .select(PRODUCT_SELECT)
      .eq("is_active", true)
      .order("sort_order")
      .order("name")
      .limit(SITEMAP_MAX_PRODUCTS),
    listAllCategories(ctx),
    ctx.tenant.modules.legal_docs
      ? getSettings(ctx, ["legal_offer", "legal_privacy", "legal_requisites", "legal_about"])
      : Promise.resolve({} as Record<string, string | null | undefined>),
  ]);
  if (products.error) throw new Error(products.error.message);
  const known = new Set(cats.map((c) => c.id));
  const visible = visibleCategoryIds(cats);

  const out: SitemapEntry[] = [{ loc: `${base}`, priority: 1 }];
  for (const c of cats)
    if (visible.has(c.id))
      out.push({ loc: `${base}?category=${encodeURIComponent(c.id)}`, priority: 0.6 });
  for (const p of (products.data ?? []) as Product[]) {
    const ids = Array.isArray(p.category_ids) ? (p.category_ids as string[]) : [];
    if (!productOnStorefront(ids, known, visible)) continue;
    if (p.fulfillment_kind !== "physical" && !productSellable(p)) continue;
    out.push({ loc: `${base}/p/${encodeURIComponent(p.id)}`, priority: 0.8 });
  }
  const legalSettings = legal as Record<string, string | null | undefined>;
  for (const doc of LEGAL_DOCS)
    if (legalSettings[`legal_${doc}`]?.trim())
      out.push({ loc: `${base}/legal/${doc}`, priority: 0.2 });
  return out;
}

const xmlEscape = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

export function sitemapXml(entries: readonly SitemapEntry[]): string {
  const rows = entries.map(
    (e) =>
      `  <url><loc>${xmlEscape(e.loc)}</loc>${
        e.priority != null ? `<priority>${e.priority.toFixed(1)}</priority>` : ""
      }</url>`,
  );
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...rows,
    "</urlset>",
    "",
  ].join("\n");
}

export function sitemapIndexXml(locs: readonly string[]): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...locs.map((l) => `  <sitemap><loc>${xmlEscape(l)}</loc></sitemap>`),
    "</sitemapindex>",
    "",
  ].join("\n");
}

/**
 * robots.txt: панели, API и корзина/заказы покупателя — не для поиска;
 * карта — индекс платформы или карта магазина на его домене.
 */
export function robotsTxt(sitemapUrl: string): string {
  return [
    "User-agent: *",
    "Disallow: /admin",
    "Disallow: /operator",
    "Disallow: /api/",
    "Disallow: /signup",
    "Disallow: /s/*/cart",
    "Disallow: /s/*/orders",
    "",
    `Sitemap: ${sitemapUrl}`,
    "",
  ].join("\n");
}
