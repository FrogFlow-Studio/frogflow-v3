import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { productCategoryIds } from "@/core/catalog/category-ids";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { OrderWithItems } from "@/core/orders/orders";
import { getSetting, setSetting } from "@/core/settings/settings";

/**
 * Публичный API магазина (модуль `public_api`): продавец или его
 * программист читает заказы и товары и правит остатки из своей учётной
 * системы (1С, МойСклад, таблицы). Вебхуки событий — модуль crm_integration
 * (core/crm/webhook). Ключ один на магазин, показывается один раз при
 * создании: `ffk_<bot_id>_<секрет>`; в app_settings `public_api_key` лежит
 * только SHA-256 секрета, дата и последние 4 знака для узнавания.
 */
export const API_KEY_SETTING = "public_api_key";
const PREFIX = "ffk_";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ApiKeyMeta = { hash: string; last4: string; createdAt: string };

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

export function parseApiKeyMeta(raw: string | null | undefined): ApiKeyMeta | null {
  try {
    const v = JSON.parse(raw ?? "null") as Partial<ApiKeyMeta> | null;
    return v && typeof v.hash === "string" && /^[0-9a-f]{64}$/.test(v.hash)
      ? { hash: v.hash, last4: String(v.last4 ?? ""), createdAt: String(v.createdAt ?? "") }
      : null;
  } catch {
    return null;
  }
}

/** Разбор ключа из заголовка: магазин и секрет; чужой формат — null. */
export function splitApiToken(token: string | null | undefined): {
  botId: string;
  secret: string;
} | null {
  const t = token?.trim() ?? "";
  if (!t.startsWith(PREFIX)) return null;
  const botId = t.slice(PREFIX.length, PREFIX.length + 36);
  const secret = t.slice(PREFIX.length + 37);
  if (!UUID.test(botId) || t[PREFIX.length + 36] !== "_" || !/^[\w-]{32,64}$/.test(secret))
    return null;
  return { botId: botId.toLowerCase(), secret };
}

/** Секрет совпадает с сохранённым отпечатком (сравнение за постоянное время). */
export function secretMatches(secret: string, meta: ApiKeyMeta | null): boolean {
  if (!meta) return false;
  const a = Buffer.from(sha256(secret));
  const b = Buffer.from(meta.hash);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function loadApiKeyMeta(ctx: TenantContext): Promise<ApiKeyMeta | null> {
  return parseApiKeyMeta(await getSetting(ctx, API_KEY_SETTING));
}

/** Новый ключ взамен прежнего; вернуть его можно только сейчас. */
export async function createApiKey(
  ctx: TenantContext,
  now = new Date(),
): Promise<{ token: string; meta: ApiKeyMeta }> {
  const secret = randomBytes(32).toString("base64url");
  const meta: ApiKeyMeta = {
    hash: sha256(secret),
    last4: secret.slice(-4),
    createdAt: now.toISOString(),
  };
  await setSetting(ctx, API_KEY_SETTING, JSON.stringify(meta));
  return { token: `${PREFIX}${ctx.tenant.id}_${secret}`, meta };
}

export async function revokeApiKey(ctx: TenantContext): Promise<void> {
  await setSetting(ctx, API_KEY_SETTING, "");
}

/** Заказ для API: без служебных полей (чек, хеши, внутренняя заметка). */
export function apiOrder(o: OrderWithItems) {
  return {
    id: o.id,
    number: o.display_no ?? o.order_no,
    status: o.status,
    created_at: o.created_at,
    updated_at: o.updated_at,
    channel: o.platform,
    total: Number(o.total),
    paid: Number(o.paid_amount ?? 0),
    currency: o.currency,
    discount: Number(o.discount_amount ?? 0),
    promo_code: o.promo_code,
    customer: {
      name: o.display_name,
      username: o.username,
      contact: o.contact,
      email: o.customer_email,
      country: o.country_code,
    },
    fulfillment: {
      kind: o.fulfillment_kind,
      type: o.fulfillment_type,
      at: o.fulfillment_at,
      address: o.fulfillment_address,
      note: o.fulfillment_note,
      delivery_fee: Number(o.delivery_fee ?? 0),
    },
    items: (o.order_items ?? []).map((i) => ({
      product_id: i.product_id,
      variant_id: i.product_variant_id,
      name: i.name_snapshot,
      quantity: Number(i.quantity),
      price: Number(i.price_snapshot),
    })),
  };
}

export type ApiProductRow = {
  id: string;
  name: string;
  price: number;
  currency: string;
  is_active: boolean;
  stock_quantity: number | null;
  fulfillment_kind: string;
  category_id: string | null;
  category_ids?: unknown;
  sort_order: number;
  description: string;
};

export function apiProduct(p: ApiProductRow) {
  return {
    id: p.id,
    name: p.name,
    price: Number(p.price),
    currency: p.currency,
    active: p.is_active,
    stock: p.stock_quantity,
    kind: p.fulfillment_kind,
    category_id: productCategoryIds(p)[0] ?? null,
    category_ids: productCategoryIds(p),
    sort_order: p.sort_order,
    description: p.description,
  };
}

export const ORDER_LIST_MAX = 100;

/** Параметры списка заказов: статус, «изменённые после», размер страницы и курсор. */
export function orderListQuery(url: URL): {
  status: string | null;
  since: string | null;
  limit: number;
  before: number | null;
} | null {
  const status = url.searchParams.get("status");
  if (status && !/^[a-z_]{2,32}$/.test(status)) return null;
  const sinceRaw = url.searchParams.get("updated_since");
  const since = sinceRaw ? new Date(sinceRaw) : null;
  if (since && Number.isNaN(since.getTime())) return null;
  const limit = Number(url.searchParams.get("limit") ?? 50);
  if (!Number.isInteger(limit) || limit < 1 || limit > ORDER_LIST_MAX) return null;
  const beforeRaw = url.searchParams.get("before_id");
  const before = beforeRaw ? Number(beforeRaw) : null;
  if (before !== null && (!Number.isInteger(before) || before <= 0)) return null;
  return { status, since: since?.toISOString() ?? null, limit, before };
}
