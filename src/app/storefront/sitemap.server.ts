import { env } from "@/config/env";
import { storefrontOpen } from "@/core/storefront/access";
import {
  robotsTxt,
  sitemapIndexXml,
  sitemapXml,
  storefrontSitemap,
} from "@/core/storefront/sitemap";
import { customHostProblem, isPlatformHost, shopForHost } from "@/core/tenant/custom-domain";
import type { Tenant } from "@/core/tenant/types";

/**
 * Карта сайта и robots.txt (core/storefront/sitemap). Общий адрес платформы:
 * индекс карт открытых витрин без своего домена. Домен магазина: его карта
 * по /sitemap.xml и robots.txt, указывающий на неё. Клиент прежней
 * платформы, архив, витрина без модуля — не попадают (storefrontOpen).
 */

const XML = {
  "content-type": "application/xml; charset=utf-8",
  "cache-control": "public, max-age=3600",
};
const TEXT = {
  "content-type": "text/plain; charset=utf-8",
  "cache-control": "public, max-age=3600",
};

/** У магазина есть рабочий свой домен — карта отдаётся там, не на общем адресе. */
function hasOwnDomain(t: Tenant, appUrl: string): boolean {
  return Boolean(t.settings.hosts?.some((h) => customHostProblem(h, appUrl) === null));
}

/** Карты витрин для индекса общего адреса. */
export function platformSitemapLocs(directory: readonly Tenant[], appUrl: string): string[] {
  return directory
    .filter((t) => t.settings.slug && storefrontOpen(t, "catalog") && !hasOwnDomain(t, appUrl))
    .map((t) => `${appUrl}/s/${t.settings.slug}/sitemap.xml`);
}

async function directory(): Promise<Tenant[]> {
  const { tenantDirectory } = await import("@/core/tenant/resolve.server");
  return tenantDirectory();
}

async function shopXml(t: Tenant, origin: string): Promise<Response> {
  const { tenantContext } = await import("@/core/tenant/resolve.server");
  const entries = await storefrontSitemap(tenantContext(t), `${origin}/s/${t.settings.slug}`);
  return new Response(sitemapXml(entries), { headers: XML });
}

const notFound = () => new Response("not found", { status: 404, headers: TEXT });

/** /s/<slug>/sitemap.xml */
export async function shopSitemapResponse(request: Request, slug: string): Promise<Response> {
  const { resolveTenant } = await import("@/core/tenant/resolve.server");
  const t = await resolveTenant({ by: "slug", value: slug.toLowerCase() });
  if (!t || !t.settings.slug || !storefrontOpen(t, "catalog")) return notFound();
  return shopXml(t, new URL(request.url).origin);
}

/** Карта страниц самой платформы (главная и ниши) — только на общем адресе. */
export const PAGES_SITEMAP = "/sitemap-pages.xml";

/** /sitemap.xml: индекс на общем адресе, карта магазина на его домене. */
export async function rootSitemapResponse(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const { APP_URL } = env();
  if (isPlatformHost(url.host, APP_URL))
    return new Response(
      sitemapIndexXml([
        `${APP_URL}${PAGES_SITEMAP}`,
        ...platformSitemapLocs(await directory(), APP_URL),
      ]),
      { headers: XML },
    );
  const shop = shopForHost(await directory(), url.host, APP_URL);
  if (!shop || !storefrontOpen(shop, "catalog")) return notFound();
  return shopXml(shop, url.origin);
}

/** /sitemap-pages.xml: главная и страницы ниш на всех языках (app/landing/niches). */
export async function pagesSitemapResponse(request: Request): Promise<Response> {
  if (!isPlatformHost(new URL(request.url).host, env().APP_URL)) return notFound();
  const { landingSitemapLocs } = await import("@/app/landing/niches");
  return new Response(sitemapXml(landingSitemapLocs().map((loc) => ({ loc }))), { headers: XML });
}

/** /robots.txt */
export function robotsResponse(request: Request): Response {
  return new Response(robotsTxt(`${new URL(request.url).origin}/sitemap.xml`), { headers: TEXT });
}
