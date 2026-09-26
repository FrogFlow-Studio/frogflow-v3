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

const PRIVATE_HOST =
  /^(localhost|.*\.local|.*\.internal|0\.0\.0\.0|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|169\.254\.\d+\.\d+|\[?::1\]?|\[?f[cd][0-9a-f]{2}:.*)$/i;

/** Только https и публичный хост — сервер не должен ходить во внутреннюю сеть по просьбе продавца. */
export function safeWebhookUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:") return false;
    if (u.username || u.password) return false;
    return !PRIVATE_HOST.test(u.hostname);
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
