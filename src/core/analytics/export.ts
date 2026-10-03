/**
 * Выгрузка аналитики в CSV для Excel (BOM, «;» — core/export/csv): файл по
 * дням (выручка, заказы, средний чек по каналам и валютам) и файл по
 * товарам за период. Чистая часть, без базы; суммы разных валют не
 * смешиваются — валюта отдельным столбцом.
 */
import { toCsv } from "@/core/export/csv";
import { topProductsBySales, type AnalyticsItem } from "./pure";

export type ExportOrder = {
  id: number;
  day: string;
  platform: string;
  currency: string;
  revenue: number;
  /** Доля выручки заказа от его суммы (заказ в работе или с возвратом); 1 — полная. */
  scale: number;
};

const money = (v: number) => Math.round(v * 100) / 100;

export const DAILY_COLUMNS = ["Дата", "Канал", "Валюта", "Выручка", "Заказов", "Средний чек"];
export const PRODUCT_COLUMNS = ["Товар", "Валюта", "Штук", "Заказов", "Выручка"];

export function dailyCsv(orders: ExportOrder[]): { csv: string; count: number } {
  const by = new Map<
    string,
    { day: string; platform: string; currency: string; revenue: number; orders: number }
  >();
  for (const o of orders) {
    const key = `${o.day}\u0000${o.platform}\u0000${o.currency}`;
    const e = by.get(key) ?? {
      day: o.day,
      platform: o.platform,
      currency: o.currency,
      revenue: 0,
      orders: 0,
    };
    e.revenue += o.revenue;
    e.orders += 1;
    by.set(key, e);
  }
  const rows = [...by.values()]
    .sort(
      (a, b) =>
        a.day.localeCompare(b.day) ||
        a.platform.localeCompare(b.platform) ||
        a.currency.localeCompare(b.currency),
    )
    .map((e) => [
      e.day,
      e.platform,
      e.currency,
      money(e.revenue),
      e.orders,
      money(e.revenue / e.orders),
    ]);
  return { csv: toCsv(DAILY_COLUMNS, rows), count: rows.length };
}

export function productsCsv(
  orders: ExportOrder[],
  items: AnalyticsItem[],
): { csv: string; count: number } {
  const currencyOf = new Map(orders.map((o) => [o.id, o.currency]));
  const currencies = [...new Set(orders.map((o) => o.currency))].sort();
  const rows: unknown[][] = [];
  for (const currency of currencies) {
    const ids = new Set(orders.filter((o) => o.currency === currency).map((o) => o.id));
    const scale = new Map(orders.filter((o) => o.scale !== 1).map((o) => [o.id, o.scale]));
    const list = topProductsBySales(
      items.filter((i) => currencyOf.get(i.order_id) === currency),
      ids,
      Infinity,
      scale,
    )
      // Равные продажи — по названию, чтобы файл не менялся от выгрузки к выгрузке.
      .sort((a, b) => b.revenue - a.revenue || b.qty - a.qty || a.name.localeCompare(b.name));
    for (const p of list) rows.push([p.name, currency, p.qty, p.orders, p.revenue]);
  }
  return { csv: toCsv(PRODUCT_COLUMNS, rows), count: rows.length };
}
