import { env } from "@/config/env";
import { customDomainRoute, isPlatformHost, shopForHost } from "@/core/tenant/custom-domain";
import { tenantDirectory } from "@/core/tenant/resolve.server";

/**
 * Запрос на домен магазина (core/tenant/custom-domain): корень — на его
 * витрину, админка и оператор — на общий адрес, чужая витрина и незнакомый
 * домен — «не найден». Общий адрес платформы — null, запрос идёт как раньше.
 * Хост берём из адреса запроса (на Vercel — домен, на который пришёл
 * запрос), а не из X-Forwarded-Host, который может прислать кто угодно.
 */
export async function customDomainResponse(request: Request): Promise<Response | null> {
  const url = new URL(request.url);
  const { APP_URL } = env();
  if (isPlatformHost(url.host, APP_URL)) return null;
  const shop = shopForHost(await tenantDirectory(), url.host, APP_URL);
  if (!shop) return notFound();
  const route = customDomainRoute(shop, url.pathname, url.search, APP_URL);
  if ("pass" in route) return null;
  if ("notFound" in route) return notFound();
  return new Response(null, { status: 302, headers: { location: route.redirect } });
}

const notFound = () =>
  new Response("Магазин не найден", {
    status: 404,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
