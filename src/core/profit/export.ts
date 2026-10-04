import { toCsv } from "@/core/export/csv";
import type { ProfitReport } from "./report";

/**
 * CSV «Прибыль по товарам» для Excel (BOM, «;» — core/export/csv). По строке на
 * товар, затем «Итого»; чужие валюты — отдельными строками с одной выручкой.
 * Где себестоимости нет, ячейки пустые, а не 0: прибыль по таким позициям не
 * считается. Суммы — в валюте магазина, она отдельным столбцом.
 */
/** Пояснение последней строкой: что в выручке и что не вычтено. */
export const PROFIT_NOTE =
  "Примечание: выручка — как в аналитике, вместе с оплаченной покупателем доставкой; расходы на доставку, комиссии платёжных систем и реклама не вычтены. Прибыль считается только по позициям с заданной себестоимостью.";

export const PROFIT_COLUMNS = [
  "Товар",
  "Валюта",
  "Штук",
  "Выручка",
  "Себестоимость",
  "Прибыль",
  "Маржа, %",
  "Штук без себестоимости",
  "Выручка без себестоимости",
];

const money = (v: number) => Math.round(v * 100) / 100;
const margin = (profit: number, revenue: number) =>
  revenue > 0 ? Math.round((profit / revenue) * 1000) / 10 : "";

export function profitCsv(rep: ProfitReport): { csv: string; count: number } {
  const rows: unknown[][] = rep.products.map((p) => {
    const none = p.unknownQty >= p.qty;
    const known = p.revenue - p.unknownRevenue;
    return [
      p.name,
      rep.currency,
      p.qty,
      money(p.revenue),
      none ? "" : money(p.cost),
      none ? "" : money(p.profit),
      none ? "" : margin(p.profit, known),
      p.unknownQty || "",
      p.unknownRevenue ? money(p.unknownRevenue) : "",
    ];
  });
  const qty = rep.products.reduce((s, p) => s + p.qty, 0);
  const knownRevenue = rep.revenue - rep.unknown.revenue;
  rows.push([
    "Итого",
    rep.currency,
    qty,
    money(rep.revenue),
    rep.margin === null ? "" : money(rep.cost),
    rep.margin === null ? "" : money(rep.profit),
    rep.margin === null ? "" : margin(rep.profit, knownRevenue),
    rep.unknown.items || "",
    rep.unknown.revenue ? money(rep.unknown.revenue) : "",
  ]);
  for (const c of rep.otherCurrencies)
    rows.push([
      `Другая валюта (${c.orders} зак.)`,
      c.currency,
      "",
      money(c.revenue),
      "",
      "",
      "",
      "",
      "",
    ]);
  rows.push([PROFIT_NOTE, "", "", "", "", "", "", "", ""]);
  return { csv: toCsv(PROFIT_COLUMNS, rows), count: rep.products.length };
}
