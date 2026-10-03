import { includeOrderInAnalytics } from "./pure";
import type { LimitedOffer } from "@/core/offers/offers";

/**
 * Итоги акции: продажи товаров акции за её срок против такого же срока ДО
 * начала. Идущая акция считается по сегодняшний день, её «до» — столько же
 * дней перед началом. В продажи идут те же заказы, что и в «Аналитике»
 * (выданные и физические в работе, includeOrderInAnalytics); выручка —
 * цена позиции на момент заказа × количество, по валютам, без учёта возвратов.
 */
export type SaleWindow = { orders: number; units: number; revenue: Record<string, number> };
export type SaleResult = {
  id: string;
  name: string;
  percent: number;
  startsAt: string;
  endsAt: string;
  running: boolean;
  during: SaleWindow;
  before: SaleWindow;
  verdict: SaleVerdict;
};
export type SaleVerdict = "up" | "flat" | "down" | "none";

export const blankWindow = (): SaleWindow => ({ orders: 0, units: 0, revenue: {} });

export type SaleOrder = {
  id: number;
  created_at: string;
  status: string;
  currency: string | null;
  fulfillment_kind?: string | null;
};
export type SaleLine = {
  order_id: number;
  product_id: string | null;
  quantity: number | string;
  price_snapshot: number | string;
};

/** Границы двух окон: срок акции (до «сейчас») и такой же срок перед ним. */
export function saleWindows(o: Pick<LimitedOffer, "starts_at" | "ends_at">, now: Date) {
  const start = Date.parse(o.starts_at);
  const end = Math.min(Date.parse(o.ends_at), now.getTime());
  const len = Math.max(0, end - start);
  return { start, end, beforeStart: start - len, len };
}

/** Продажи затронутых товаров в двух окнах. `products` — товары акции. */
export function sellThrough(
  o: Pick<LimitedOffer, "starts_at" | "ends_at">,
  products: ReadonlySet<string>,
  orders: ReadonlyMap<number, SaleOrder>,
  lines: readonly SaleLine[],
  now: Date,
): { during: SaleWindow; before: SaleWindow } {
  const w = saleWindows(o, now);
  const during = blankWindow();
  const before = blankWindow();
  const seen = { during: new Set<number>(), before: new Set<number>() };
  for (const l of lines) {
    if (!l.product_id || !products.has(l.product_id)) continue;
    const order = orders.get(l.order_id);
    if (!order || !includeOrderInAnalytics(order)) continue;
    const at = Date.parse(order.created_at);
    const key =
      at >= w.start && at < w.end
        ? "during"
        : at >= w.beforeStart && at < w.start
          ? "before"
          : null;
    if (!key) continue;
    const win = key === "during" ? during : before;
    const qty = Number(l.quantity) || 0;
    const cur = order.currency || "—";
    win.units += qty;
    win.revenue[cur] = (win.revenue[cur] ?? 0) + (Number(l.price_snapshot) || 0) * qty;
    if (!seen[key].has(order.id)) {
      seen[key].add(order.id);
      win.orders += 1;
    }
  }
  return { during, before };
}

/** Дала ли акция продажи: по штукам, ±10 % — «примерно как раньше». */
export function saleVerdict(during: SaleWindow, before: SaleWindow): SaleVerdict {
  if (during.units === 0 && before.units === 0) return "none";
  if (before.units === 0) return "up";
  const ratio = during.units / before.units;
  return ratio > 1.1 ? "up" : ratio < 0.9 ? "down" : "flat";
}
