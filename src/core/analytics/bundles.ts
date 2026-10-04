import { isGiftWrapRow } from "@/core/orders/gift-wrap";
import { includeOrderInAnalytics } from "./pure";
import type { SaleOrder } from "./sales";

/**
 * Итоги наборов и подарков (Н8) за период. В счёт идут те же заказы, что в
 * «Аналитике» (выданные и физические в работе, includeOrderInAnalytics):
 * неоплаченный, отклонённый и отменённый заказ не считается ни набором, ни
 * подарком. Выручка — цена позиции на момент заказа × количество, по валютам.
 * «Сэкономили покупатели» — выгода набора по нынешним ценам составляющих ×
 * проданные штуки (набор не дешевле — выгода ноль, отрицательной не бывает).
 * Упаковка — отдельная строка заказа с меткой в названии (core/orders/gift-wrap).
 */
export type BundleLine = {
  order_id: number;
  product_id: string | null;
  name_snapshot?: string | null;
  quantity: number | string;
  price_snapshot: number | string;
};

export type Money = Record<string, number>;
export type BundleRow = { id: string; name: string; units: number; revenue: Money; saving: Money };
export type BundleGiftStats = {
  bundles: { orders: number; units: number; revenue: Money; saving: Money; rows: BundleRow[] };
  gifts: {
    /** Оплаченных заказов за период всего и из них подарков. */
    orders: number;
    gifts: number;
    wrapOrders: number;
    wrapRevenue: Money;
  };
};

const add = (m: Money, cur: string, v: number) => {
  m[cur] = (m[cur] ?? 0) + v;
};

export function bundleGiftStats(input: {
  orders: ReadonlyMap<number, SaleOrder>;
  lines: readonly BundleLine[];
  giftOrderIds: ReadonlySet<number>;
  /** id набора → название. */
  bundles: ReadonlyMap<string, string>;
  /** id набора → выгода одной штуки и её валюта. */
  savingPerUnit: ReadonlyMap<string, { currency: string; amount: number }>;
}): BundleGiftStats {
  const paid = new Map([...input.orders].filter(([, o]) => includeOrderInAnalytics(o)));
  const out: BundleGiftStats = {
    bundles: { orders: 0, units: 0, revenue: {}, saving: {}, rows: [] },
    gifts: {
      orders: paid.size,
      gifts: [...paid.keys()].filter((id) => input.giftOrderIds.has(id)).length,
      wrapOrders: 0,
      wrapRevenue: {},
    },
  };
  const rows = new Map<string, BundleRow>();
  const bundleOrders = new Set<number>();
  const wrapOrders = new Set<number>();
  for (const l of input.lines) {
    const order = paid.get(Number(l.order_id));
    if (!order) continue;
    const qty = Number(l.quantity) || 0;
    const sum = (Number(l.price_snapshot) || 0) * qty;
    const cur = order.currency || "—";
    if (isGiftWrapRow(l.name_snapshot)) {
      add(out.gifts.wrapRevenue, cur, sum);
      wrapOrders.add(order.id);
      continue;
    }
    if (!l.product_id || !input.bundles.has(l.product_id)) continue;
    const row = rows.get(l.product_id) ?? {
      id: l.product_id,
      name: input.bundles.get(l.product_id)!,
      units: 0,
      revenue: {},
      saving: {},
    };
    rows.set(l.product_id, row);
    row.units += qty;
    out.bundles.units += qty;
    add(row.revenue, cur, sum);
    add(out.bundles.revenue, cur, sum);
    const per = input.savingPerUnit.get(l.product_id);
    if (per && per.amount > 0) {
      add(row.saving, per.currency, per.amount * qty);
      add(out.bundles.saving, per.currency, per.amount * qty);
    }
    bundleOrders.add(order.id);
  }
  out.bundles.orders = bundleOrders.size;
  out.gifts.wrapOrders = wrapOrders.size;
  out.bundles.rows = [...rows.values()].sort(
    (a, b) => b.units - a.units || a.id.localeCompare(b.id),
  );
  return out;
}
