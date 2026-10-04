/**
 * История остатка товара: каждое изменение `products.stock_quantity` оставляет
 * событие в `zernio_logs` — `event_type = stock.<причина>`, `status = event`,
 * в `payload` — товар, «было → стало», заказ и кто. Своей таблицы нет (схема
 * не меняется), ретеншн держит такие строки 180 дней; в карточке товара
 * показываются последние 30.
 *
 * Запись события — на лучшее усилие: остаток уже изменён, сбой журнала не
 * должен ни откатывать списание, ни ронять заказ — только в консоль.
 * Не отслеживаемый остаток (null) событие пишет так же: «не учитывался → 5».
 */
import { serverFailure } from "@/lib/server-failure";
import { inChunks } from "@/lib/in-chunks";
import { displayNo } from "@/core/orders/pure";
import type { Json } from "@/core/db-types";
import type { TenantContext } from "@/core/tenant/resolve.server";

export const STOCK_REASONS = [
  /** Покупатель оформил заказ: остаток списан. */
  "order",
  /** Заказ отклонён, отменён или истёк: списанное вернулось. */
  "cancel",
  /** Возврат денег по заказу вернул товар на склад. */
  "refund",
  /** Заказ заведён продавцом вручную. */
  "manual_order",
  /** Правка остатка в карточке товара. */
  "edit",
  /** Массовое «установить / прибавить остаток». */
  "bulk",
  /** Импорт файла каталога. */
  "import",
  /** Синхронизация с таблицей Google. */
  "sheet",
  /** Внешний API (PATCH /api/v1/products). */
  "api",
] as const;
export type StockReason = (typeof STOCK_REASONS)[number];

export type StockChange = {
  productId: string;
  /** null — остаток не отслеживался. */
  from: number | null;
  to: number | null;
};

export type StockMeta = {
  reason: StockReason;
  orderId?: number;
  /** `admin:<логин>`, `customer`, `system`. */
  actor?: string;
};

export const STOCK_EVENT_PREFIX = "stock.";
export const STOCK_HISTORY_DAYS = 30;
export const STOCK_HISTORY_PAGE = 20;

/** Записать изменения остатка; «было = стало» не события. Не бросает. */
export async function recordStockChanges(
  ctx: TenantContext,
  changes: StockChange[],
  meta: StockMeta,
): Promise<void> {
  const rows = changes
    .filter((c) => c.from !== c.to)
    .map((c) => ({
      bot_id: ctx.tenant.id,
      // Случайная часть — два изменения одного товара в одну миллисекунду не сольются.
      event_id: `stock:${c.productId}:${meta.reason}:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
      event_type: `${STOCK_EVENT_PREFIX}${meta.reason}`,
      status: "event",
      payload: {
        product_id: c.productId,
        from: c.from,
        to: c.to,
        ...(meta.orderId !== undefined ? { order_id: meta.orderId } : {}),
        actor: meta.actor ?? "system",
      } as Json,
    }));
  if (rows.length === 0) return;
  const { error } = await ctx.db.from("zernio_logs").insert(rows);
  if (error) console.warn(`[stock] история остатка не записана: ${error.message}`);
}

export async function recordStockChange(
  ctx: TenantContext,
  change: StockChange,
  meta: StockMeta,
): Promise<void> {
  await recordStockChanges(ctx, [change], meta);
}

export type StockHistoryEntry = {
  id: string;
  at: string;
  reason: StockReason;
  from: number | null;
  to: number | null;
  orderId: number | null;
  /** Номер заказа, каким его видит продавец (display_no); null — заказ не нашёлся. */
  orderNo: number | null;
  actor: string;
};

const asNumOrNull = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

/**
 * Страница истории остатка товара, свежие сверху. Сортировка кончается id,
 * чтобы события одной секунды не менялись местами между страницами; `total` —
 * сколько всего за период (для «Показать ещё»).
 */
export async function listStockHistory(
  ctx: TenantContext,
  productId: string,
  opts: { page?: number; pageSize?: number; days?: number; now?: Date } = {},
): Promise<{ entries: StockHistoryEntry[]; total: number }> {
  const page = Math.max(0, Math.floor(opts.page ?? 0));
  const size = Math.min(100, Math.max(1, Math.floor(opts.pageSize ?? STOCK_HISTORY_PAGE)));
  const since = new Date(
    (opts.now ?? new Date()).getTime() - (opts.days ?? STOCK_HISTORY_DAYS) * 86_400_000,
  ).toISOString();
  const { data, error, count } = await ctx.db
    .from("zernio_logs")
    .select("id, created_at, event_type, payload", { count: "exact" })
    .eq("status", "event")
    .like("event_type", `${STOCK_EVENT_PREFIX}%`)
    .eq("payload->>product_id", productId)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(page * size, page * size + size - 1);
  if (error) throw serverFailure(`История остатка: ${error.message}`);
  const known = new Set<string>(STOCK_REASONS);
  const entries: StockHistoryEntry[] = [];
  for (const r of data ?? []) {
    const reason = r.event_type.slice(STOCK_EVENT_PREFIX.length);
    if (!known.has(reason)) continue;
    const p =
      r.payload && typeof r.payload === "object" && !Array.isArray(r.payload)
        ? (r.payload as Record<string, unknown>)
        : {};
    entries.push({
      id: r.id,
      at: r.created_at,
      reason: reason as StockReason,
      from: asNumOrNull(p.from),
      to: asNumOrNull(p.to),
      orderId: asNumOrNull(p.order_id),
      orderNo: null,
      actor: typeof p.actor === "string" ? p.actor : "system",
    });
  }
  const orderIds = [...new Set(entries.flatMap((e) => (e.orderId === null ? [] : [e.orderId])))];
  if (orderIds.length > 0) {
    const orders = await inChunks(
      orderIds,
      (chunk) =>
        ctx.db.from("orders").select("id, order_no, display_no").in("id", chunk).order("id"),
      "История остатка: заказы",
    );
    const nos = new Map(orders.map((o) => [Number(o.id), displayNo(o)]));
    for (const e of entries) if (e.orderId !== null) e.orderNo = nos.get(e.orderId) ?? null;
  }
  return { entries, total: count ?? entries.length };
}
