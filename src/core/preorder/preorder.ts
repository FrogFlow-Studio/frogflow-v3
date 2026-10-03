import { inChunks } from "@/lib/in-chunks";
import { serverFailure } from "@/lib/server-failure";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { getSettingStrict, setSetting } from "@/core/settings/settings";

/**
 * Предзаказ: товар, которого сейчас нет на складе, но продавец берёт заказы
 * и называет срок отправки. Схема базы не меняется: на каждый товар одна
 * строка app_settings `preorder:<id>` со значением `YYYY-MM-DD` (отправка
 * с этой даты) или `-` (дату не назвали); пустое значение — предзаказа нет.
 * Строка на товар, а не общий список: два продавца или две вкладки админки
 * не затирают друг друга.
 *
 * Предзаказ работает только с модулем «Склад» и только пока остатка не
 * хватает: есть остаток — товар продаётся и списывается как обычно. Позиции
 * предзаказа остаток не списывают (он не уходит в минус) и при возврате
 * заказа не возвращают (иначе на складе появился бы товар, которого нет);
 * какие позиции были предзаказными, запоминает событие заказа `preorder`.
 */
export const PREORDER_PREFIX = "preorder:";
export const PREORDER_NO_DATE = "-";

export type Preorder = { from: string | null };

export const preorderKey = (productId: string): string => `${PREORDER_PREFIX}${productId}`;

/** Значение настройки → предзаказ; пусто и мусор — «предзаказа нет». */
export function parsePreorder(raw: string | null | undefined): Preorder | null {
  const v = (raw ?? "").trim();
  if (v === PREORDER_NO_DATE) return { from: null };
  return /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) ? { from: v } : null;
}

/** Остатка не хватает на `qty` штук (qty = 1 — «нет в наличии»). */
function short(stock: number | null | undefined, qty: number): boolean {
  return stock != null && stock < qty;
}

export async function getPreorder(ctx: TenantContext, productId: string): Promise<Preorder | null> {
  if (!ctx.tenant.modules.stock) return null;
  return parsePreorder(await getSettingStrict(ctx, preorderKey(productId)));
}

/** Предзаказы по списку товаров одним запросом (кусками): id → предзаказ. */
export async function preordersFor(
  ctx: TenantContext,
  productIds: readonly string[],
): Promise<Map<string, Preorder>> {
  const out = new Map<string, Preorder>();
  if (!ctx.tenant.modules.stock || productIds.length === 0) return out;
  const rows = await inChunks(
    productIds.map(preorderKey),
    (chunk) => ctx.db.from("app_settings").select("key, value").in("key", chunk),
    "Предзаказы",
  );
  for (const r of rows) {
    const p = parsePreorder(r.value);
    if (p) out.set(r.key.slice(PREORDER_PREFIX.length), p);
  }
  return out;
}

/**
 * Предзаказ, который действует для товара сейчас: он включён и остатка не
 * хватает на `qty`. null — продаём обычным порядком (есть остаток, остаток
 * не ведётся или предзаказ не включён).
 */
export function activePreorder(
  ctx: TenantContext,
  product: { stock_quantity: number | null },
  flag: Preorder | null | undefined,
  qty = 1,
): Preorder | null {
  return ctx.tenant.modules.stock && flag && short(product.stock_quantity, qty) ? flag : null;
}

/** Включить предзаказ товару (дата `YYYY-MM-DD` или null — без даты) или выключить (`off`). */
export async function savePreorder(
  ctx: TenantContext,
  productId: string,
  value: { on: false } | { on: true; from: string | null },
): Promise<void> {
  const key = preorderKey(productId);
  // Выключать нечего, если предзаказа не было: пустые строки на каждый сохранённый товар не плодим.
  if (!value.on && !(await getSettingStrict(ctx, key))) return;
  await setSetting(ctx, key, value.on ? (value.from ?? PREORDER_NO_DATE) : "");
}

export type PreorderLine = { product_id: string; quantity: number; from: string | null };

/**
 * Позиции заказа, оформленные как предзаказ, — по событию `preorder`.
 * Сбой чтения наружу: «не знаем» нельзя читать как «таких не было» (товар
 * лишний раз вернулся бы на склад).
 */
export async function preorderLinesOfOrder(
  ctx: TenantContext,
  orderId: number,
): Promise<PreorderLine[]> {
  const { data, error } = await ctx.db
    .from("zernio_logs")
    .select("payload")
    .eq("event_type", "order.preorder")
    .eq("payload->>order_id", String(orderId))
    .order("id");
  if (error) throw serverFailure(`Предзаказ по заказу #${orderId}: ${error.message}`);
  const out: PreorderLine[] = [];
  for (const row of data ?? []) {
    const lines = (row.payload as { lines?: unknown } | null)?.lines;
    if (!Array.isArray(lines)) continue;
    for (const l of lines as PreorderLine[])
      if (l && typeof l.product_id === "string" && Number(l.quantity) > 0)
        out.push({ product_id: l.product_id, quantity: Number(l.quantity), from: l.from ?? null });
  }
  return out;
}
