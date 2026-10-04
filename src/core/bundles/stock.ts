import { loadBundle, type BundleItem } from "@/core/bundles/bundle";
import { recordStockChanges, type StockChange } from "@/core/catalog/stock-history";
import { pageAll } from "@/core/db/page";
import { decrementStock, restoreStock } from "@/core/fulfillment/fulfillment";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { inChunks } from "@/lib/in-chunks";

/**
 * Остаток набора и списание составляющих (модуль `bundles`, Н2).
 *
 * Набор своего остатка не имеет: сколько наборов можно собрать — минимум по
 * составляющим (остаток / штук в наборе, вниз). Составляющая без учёта остатка
 * (null) не ограничивает; если не учитывается ни одна — набор без предела.
 * Удалённая составляющая — 0. Остаток у товара один на все варианты, поэтому
 * вариант составляющей на счёт не влияет.
 *
 * Заказ набора списывает составляющие (штук в наборе × штук в заказе) и пишет
 * по ним события `stock.bundle` с `bundle_id` и номером заказа. Отмена,
 * отклонение и возврат кладут назад ровно то, что записано в этих событиях —
 * не текущий состав: продавец мог поменять его после заказа. Заказ набора до
 * этой правки событий не имеет, и склад ему не возвращается (списания не было).
 */

/** Сколько наборов собирается из остатка; null — предела нет. */
export function bundleCapacity(
  items: readonly BundleItem[],
  stock: ReadonlyMap<string, number | null>,
): number | null {
  let min: number | null = null;
  for (const it of items) {
    const have = stock.has(it.productId) ? stock.get(it.productId)! : 0;
    if (have === null) continue;
    const n = Math.max(0, Math.floor(have / Math.max(1, it.qty)));
    min = min === null ? n : Math.min(min, n);
  }
  return min;
}

/** Остаток наборов по составу (читает остатки составляющих). */
export async function bundleStock(
  ctx: TenantContext,
  items: readonly BundleItem[],
): Promise<number | null> {
  const rows = await inChunks(
    items.map((i) => i.productId),
    (chunk) =>
      ctx.db
        .from("products")
        .select("id, stock_quantity")
        .in("id", chunk) as unknown as PromiseLike<{
        data: Array<{ id: string; stock_quantity: number | null }> | null;
        error: { message: string } | null;
      }>,
    "Остаток набора",
  );
  return bundleCapacity(items, new Map(rows.map((r) => [r.id, r.stock_quantity])));
}

/** Накопитель одного оформления: что списано и что вернуть при откате. */
export type StockTake = {
  changes: StockChange[];
  /** Составляющие наборов по id набора — в историю как `stock.bundle`. */
  bundleChanges: Map<string, StockChange[]>;
  reserved: Array<{ productId: string; qty: number }>;
};

export const newStockTake = (): StockTake => ({
  changes: [],
  bundleChanges: new Map(),
  reserved: [],
});

/** Состав набора, если товар — набор и модуль включён; иначе null. */
export async function bundleOf(
  ctx: TenantContext,
  productId: string,
): Promise<BundleItem[] | null> {
  if (!ctx.tenant.modules.bundles) return null;
  return loadBundle(ctx, productId);
}

/**
 * Списать составляющие `qty` наборов. false — какой-то не хватило: уже
 * списанное остаётся в `take.reserved`, откат делает вызывающий (как у
 * обычных позиций).
 */
export async function decrementBundle(
  ctx: TenantContext,
  bundleId: string,
  items: readonly BundleItem[],
  qty: number,
  take: StockTake,
): Promise<boolean> {
  const sink: StockChange[] = [];
  for (const it of items) {
    const n = it.qty * qty;
    const ok = await decrementStock(ctx, it.productId, n, sink);
    if (!ok) {
      take.bundleChanges.set(bundleId, [...(take.bundleChanges.get(bundleId) ?? []), ...sink]);
      return false;
    }
    take.reserved.push({ productId: it.productId, qty: n });
  }
  take.bundleChanges.set(bundleId, [...(take.bundleChanges.get(bundleId) ?? []), ...sink]);
  return true;
}

/** Записать события `stock.bundle` по всем наборам оформления. Не бросает. */
export async function recordBundleChanges(
  ctx: TenantContext,
  take: StockTake,
  meta: { orderId: number; actor: string },
): Promise<void> {
  for (const [bundleId, changes] of take.bundleChanges)
    await recordStockChanges(ctx, changes, {
      reason: "bundle",
      orderId: meta.orderId,
      actor: meta.actor,
      extra: { bundle_id: bundleId },
    });
}

type StockEvent = { event_type: string; payload: Record<string, unknown> | null };

/**
 * Вернуть на склад составляющие наборов заказа. Какие позиции были наборами,
 * решают события `stock.bundle` этого заказа, а не текущая настройка: продавец
 * мог снять «Это набор» или поменять состав уже после заказа. Возвращается то,
 * что записано в событиях; набор, который уже возвращали (есть событие возврата
 * с его `bundle_id`), второй раз не возвращается. Результат: `bundleIds` —
 * наборы заказа (их строки обычным путём не возвращаются), `n` — сколько
 * наборов вернули сейчас.
 */
export async function restoreOrderBundles(
  ctx: TenantContext,
  orderId: number,
  reason: "cancel" | "refund",
  actor: string,
): Promise<{ bundleIds: Set<string>; n: number }> {
  const events = await pageAll<StockEvent>(
    (from, to) =>
      ctx.db
        .from("zernio_logs")
        .select("event_type, payload")
        .eq("status", "event")
        .like("event_type", "stock.%")
        .eq("payload->>order_id", String(orderId))
        .order("id")
        .range(from, to) as unknown as PromiseLike<{
        data: StockEvent[] | null;
        error: { message: string } | null;
      }>,
    "События остатка заказа",
  );
  const bundleIds = new Set(
    events
      .filter((e) => e.event_type === "stock.bundle")
      .map((e) => String(e.payload?.bundle_id ?? ""))
      .filter(Boolean),
  );
  let n = 0;
  for (const id of bundleIds) {
    const mine = events.filter((e) => e.payload?.bundle_id === id);
    if (mine.some((e) => e.event_type !== "stock.bundle")) continue;
    const taken = new Map<string, number>();
    for (const e of mine) {
      const from = Number(e.payload?.from);
      const to = Number(e.payload?.to);
      const pid = String(e.payload?.product_id ?? "");
      if (!pid || !Number.isFinite(from) || !Number.isFinite(to) || from <= to) continue;
      taken.set(pid, (taken.get(pid) ?? 0) + (from - to));
    }
    for (const [productId, qty] of taken)
      await restoreStock(ctx, productId, qty, {
        reason,
        orderId,
        actor,
        extra: { bundle_id: id },
      });
    if (taken.size) n++;
  }
  return { bundleIds, n };
}
