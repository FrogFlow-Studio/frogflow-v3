import type { Tenant } from "./types";
import { servedByV2 } from "./directory";

/**
 * Свой домен клиента: витрина и Mini App открываются на домене магазина из
 * bots.settings.hosts (оператор записывает его в карточке клиента после того,
 * как домен подключён к проекту Vercel). Общий адрес платформы (APP_URL, его
 * поддомены, *.vercel.app, localhost) магазину не принадлежит никогда — так
 * запись в hosts не может перехватить платформу. На домене магазина
 * открывается только его витрина; админка, оператор и регистрация — только
 * на общем адресе.
 */

const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;

/** Имя хоста без порта и точки в конце, в нижнем регистре; неразборчивое — null. */
export function normalizeHost(raw: string | null | undefined): string | null {
  const s = (raw ?? "").trim().toLowerCase();
  if (!s) return null;
  if (s.startsWith("[")) return /^\[[0-9a-f:.]+\](:\d+)?$/.test(s) ? s.replace(/:\d+$/, "") : null;
  const host = s.replace(/:\d+$/, "").replace(/\.$/, "");
  if (host.length > 253) return null;
  return host.split(".").every((l) => LABEL.test(l)) ? host : null;
}

const isIp = (h: string) => h.startsWith("[") || /^\d+\.\d+\.\d+\.\d+$/.test(h);

/** Домен платформы по APP_URL: www.frogflow.tech → frogflow.tech. */
function platformApex(appUrl: string): string | null {
  const host = normalizeHost(safeHost(appUrl));
  if (!host || isIp(host)) return host;
  return host.split(".").slice(-2).join(".");
}

function safeHost(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

/** Адрес платформы или служебный — не может быть доменом магазина. */
export function isPlatformHost(raw: string, appUrl: string): boolean {
  const h = normalizeHost(raw);
  if (!h) return true;
  if (isIp(h) || h === "localhost" || h.endsWith(".localhost")) return true;
  if (h === "vercel.app" || h.endsWith(".vercel.app")) return true;
  const apex = platformApex(appUrl);
  return !!apex && (h === apex || h.endsWith(`.${apex}`));
}

/** Почему домен нельзя записать магазину (текст для оператора) или null. */
export function customHostProblem(raw: string, appUrl: string): string | null {
  const h = normalizeHost(raw);
  if (!h || !h.includes(".") || raw.includes("/"))
    return `«${raw}» — не домен. Укажите имя вроде shop.example.kz, без https:// и пути.`;
  if (isPlatformHost(h, appUrl)) return `«${h}» — адрес платформы, его нельзя отдать магазину.`;
  return null;
}

/**
 * Магазин, чья витрина открывается на этом домене: ровно один владелец
 * домена, обслуживается v2 (CLAUDE.md, правило 6), не в архиве, с коротким
 * адресом. Иначе — null.
 */
export function shopForHost(
  directory: readonly Tenant[],
  rawHost: string,
  appUrl: string,
): Tenant | null {
  const h = normalizeHost(rawHost);
  if (!h || isPlatformHost(h, appUrl)) return null;
  const owners = directory.filter((t) => t.settings.hosts?.includes(h));
  if (owners.length !== 1) return null;
  const t = owners[0]!;
  if (t.archived || !servedByV2(t) || !t.settings.slug) return null;
  return t;
}

export type DomainRoute = { pass: true } | { redirect: string } | { notFound: true };

const PLATFORM_ONLY = /^\/(admin|operator|signup)(\/|$)/;

/** Что делать с запросом на домене магазина. */
export function customDomainRoute(
  t: Tenant,
  path: string,
  search: string,
  appUrl: string,
): DomainRoute {
  const slug = t.settings.slug!;
  if (path === "/" || path === "") return { redirect: `/s/${slug}${search}` };
  if (PLATFORM_ONLY.test(path)) return { redirect: `${appUrl}${path}${search}` };
  const m = path.match(/^\/s\/([^/]+)/);
  if (m && decodeSegment(m[1]!)?.toLowerCase() !== slug) return { notFound: true };
  return { pass: true };
}

/** Сегмент пути без %-кодирования; кривой «%» — null (не 500). */
function decodeSegment(seg: string): string | null {
  try {
    return decodeURIComponent(seg);
  } catch {
    return null;
  }
}

/** Адрес витрины магазина (и Mini App): свой домен, если есть, иначе общий. */
export function storefrontBase(t: Tenant, appUrl: string): string {
  const slug = t.settings.slug;
  const host = slug
    ? t.settings.hosts?.find((h) => customHostProblem(h, appUrl) === null)
    : undefined;
  return host ? `https://${host}/s/${slug}` : `${appUrl}/s/${slug ?? t.id}`;
}

/** Домены для записи в settings.hosts: нормализованы, без повторов; первая ошибка — текстом. */
export function cleanHosts(
  list: readonly string[],
  appUrl: string,
): { hosts: string[] } | { error: string } {
  const hosts: string[] = [];
  for (const raw of list) {
    if (!raw.trim()) continue;
    const problem = customHostProblem(raw.trim(), appUrl);
    if (problem) return { error: problem };
    const h = normalizeHost(raw)!;
    if (!hosts.includes(h)) hosts.push(h);
  }
  return { hosts };
}
