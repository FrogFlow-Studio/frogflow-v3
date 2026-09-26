import { createHmac } from "node:crypto";
import type { Json } from "@/core/db-types";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { getSetting, setSetting } from "@/core/settings/settings";

/**
 * Интеграция с CRM и Таблицами (модуль crm_integration): события заказа
 * уходят POST-запросом JSON на адрес продавца — amoCRM/Bitrix24 через их
 * входящие вебхуки, Google Таблицы через веб-приложение Apps Script, Make,
 * Zapier. Подпись — HMAC-SHA256 тела секретом продавца в заголовке
 * `X-FrogFlow-Signature: sha256=<hex>`. Доставка — через outbox: отказ
 * адресата повторяется с растущей паузой и виден в «Не доставлено».
 * Адрес — только https и не во внутреннюю сеть (защита от SSRF).
 */
export const CRM_KEY = "crm_webhook";

export const CRM_EVENTS = [
  "placed",
  "proof",
  "delivered",
  "delivery_failed",
  "rejected",
  "status",
] as const;
export type CrmEvent = (typeof CRM_EVENTS)[number];

export type CrmConfig = { url: string; secret: string; events: CrmEvent[] };

export function parseCrm(raw: string | null | undefined): CrmConfig | null {
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as Partial<CrmConfig>;
    if (typeof p.url !== "string" || !safeWebhookUrl(p.url)) return null;
    const events = Array.isArray(p.events)
      ? p.events.filter((e): e is CrmEvent => (CRM_EVENTS as readonly string[]).includes(e))
      : [...CRM_EVENTS];
    return { url: p.url, secret: typeof p.secret === "string" ? p.secret : "", events };
  } catch {
    return null;
  }
}

const PRIVATE_NAME = /^(localhost|.*\.localhost|.*\.local|.*\.internal)$/i;

function ipv4Private(ip: string): boolean {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((x) => !Number.isInteger(x) || x < 0 || x > 255)) return true;
  const [a, b] = p as [number, number, number, number];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

/**
 * Адрес во внутренней сети (или служебный): loopback, частные диапазоны,
 * link-local (в том числе метаданные облака 169.254.169.254), CGNAT,
 * multicast; IPv6 — ::, ::1, fc00::/7, fe80::/10 и IPv4, завёрнутый в IPv6.
 */
export function isPrivateAddress(raw: string): boolean {
  const ip = raw.replace(/^\[|\]$/g, "").toLowerCase();
  if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return ipv4Private(ip);
  if (!ip.includes(":")) return true;
  const mapped = ip.match(/^(?:0*:)*:?ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return ipv4Private(mapped[1]!);
  const hex = ip.match(/^(?:0*:)*:?ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hex) {
    const hi = parseInt(hex[1]!, 16);
    const lo = parseInt(hex[2]!, 16);
    return ipv4Private(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  }
  if (ip === "::" || ip === "::1") return true;
  const first = parseInt(ip.split(":")[0] || "0", 16);
  return (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80 || (first & 0xff00) === 0xff00;
}

const isIpLiteral = (h: string) => /^\d+\.\d+\.\d+\.\d+$/.test(h) || h.startsWith("[");

/**
 * Только https и публичный хост — сервер не должен ходить во внутреннюю сеть
 * по просьбе продавца. Проверка по записи адреса; имя, которое резолвится во
 * внутренний адрес (127.0.0.1.nip.io), ловит resolvesPublic перед отправкой.
 */
export function safeWebhookUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:") return false;
    if (u.username || u.password) return false;
    const host = u.hostname.toLowerCase();
    if (PRIVATE_NAME.test(host)) return false;
    return isIpLiteral(host) ? !isPrivateAddress(host) : true;
  } catch {
    return false;
  }
}

/** Все адреса имени публичные — проверка прямо перед запросом. Ошибка DNS — нет. */
export async function resolvesPublic(hostname: string): Promise<boolean> {
  const host = hostname.toLowerCase();
  if (isIpLiteral(host)) return !isPrivateAddress(host);
  try {
    const { lookup } = await import("node:dns/promises");
    const addrs = await lookup(host, { all: true, verbatim: true });
    return addrs.length > 0 && addrs.every((a) => !isPrivateAddress(a.address));
  } catch {
    return false;
  }
}

export function signBody(body: string, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

export async function loadCrm(ctx: TenantContext): Promise<CrmConfig | null> {
  return parseCrm(await getSetting(ctx, CRM_KEY));
}

export async function saveCrm(ctx: TenantContext, cfg: CrmConfig | null): Promise<void> {
  await setSetting(ctx, CRM_KEY, cfg ? JSON.stringify(cfg) : "");
}

/** Тело события: заказ плоско, позиции списком — то, что удобно положить строкой в таблицу. */
export async function crmPayload(
  ctx: TenantContext,
  event: string,
  orderId: number,
  extra: Record<string, Json | undefined> = {},
): Promise<Record<string, Json> | null> {
  const { data: o } = await ctx.db
    .from("orders")
    .select(
      "id, order_no, display_no, status, total, currency, platform, display_name, username, contact, customer_email, country_name, fulfillment_kind, created_at, order_items(name_snapshot, quantity, price_snapshot)",
    )
    .eq("id", orderId)
    .maybeSingle();
  if (!o) return null;
  return {
    event: `order.${event}`,
    at: new Date().toISOString(),
    shop_id: ctx.tenant.id,
    order: {
      id: o.id,
      number: o.display_no ?? o.order_no,
      status: o.status,
      total: Number(o.total),
      currency: o.currency,
      channel: o.platform,
      customer: o.display_name,
      username: o.username,
      phone: o.contact,
      email: o.customer_email,
      country: o.country_name,
      kind: o.fulfillment_kind,
      created_at: o.created_at,
      items: (o.order_items ?? []).map((i) => ({
        name: i.name_snapshot,
        qty: i.quantity,
        price: Number(i.price_snapshot),
      })),
    },
    details: extra as Json,
  };
}

/** Поставить событие в очередь доставки (core/outbox); ушлёт минутный крон. */
export async function queueCrmEvent(
  ctx: TenantContext,
  event: string,
  orderId: number,
  extra: Record<string, Json | undefined> = {},
): Promise<boolean> {
  if (!ctx.tenant.modules.crm_integration) return false;
  if (!(CRM_EVENTS as readonly string[]).includes(event)) return false;
  const cfg = await loadCrm(ctx);
  if (!cfg || !cfg.events.includes(event as CrmEvent)) return false;
  const body = await crmPayload(ctx, event, orderId, extra);
  if (!body) return false;
  const { enqueueOutbox } = await import("@/core/outbox/outbox");
  await enqueueOutbox(
    ctx,
    {
      kind: "crm_webhook",
      target: { channel: "webhook", url: cfg.url },
      text: JSON.stringify(body),
      orderId,
      audience: "admin",
    },
    null,
  );
  return true;
}
