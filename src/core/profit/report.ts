import { eachPage, pageAll } from "@/core/db/page";
import { analyticsRevenue, dayKey, dayKeys, includeOrderInAnalytics } from "@/core/analytics/pure";
import { shopCurrency } from "@/core/discounts/discounts";
import { ORDER_EVENT_STATUS } from "@/core/orders/events";
import { netOfRefunds } from "@/core/orders/refund";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { itemUnitCost, listCosts, type ProductCost } from "./cost";
import { loadSnapshots, type OrderCostSnapshot } from "./snapshot";

/**
 * Валовая прибыль за период («Аналитика», модуль `profit`). Те же заказы и та
 * же выручка, что в аналитике: засчитанные по includeOrderInAnalytics, за
 * вычетом возвратов (netOfRefunds). Выручка заказа раскладывается по его
 * позициям пропорционально цена × количество, поэтому выручка по товарам в
 * сумме равна выручке заказов, а скидки и доставка не теряются.
 *
 * Себестоимость позиции — из снимка в момент продажи (snapshot.ts); нет
 * снимка или в нём null — текущая себестоимость, и позиция считается «по
 * текущей». Нет и её — позиция «без себестоимости»: прибыль по ней не
 * выдумывается, а её выручка выводится отдельной строкой и из прибыли и
 * маржи исключается. Возврат с возвратом на склад уменьшает себестоимость
 * заказа в той же доле, что выручку; возврат без склада её не трогает.
 *
 * Валюты не складываются: себестоимость хранится в валюте магазина, поэтому
 * прибыль считается только по заказам в ней, остальные валюты — отдельными
 * строками с одной выручкой.
 */
export type ProfitProduct = {
  key: string;
  name: string;
  qty: number;
  /** Выручка по товару, все позиции. */
  revenue: number;
  /** Себестоимость проданных позиций, где она известна. */
  cost: number;
  /** Прибыль по позициям с известной себестоимостью. */
  profit: number;
  unknownQty: number;
  unknownRevenue: number;
};

export type ProfitReport = {
  days: number;
  /** Валюта магазина — в ней себестоимость и прибыль. */
  currency: string;
  revenue: number;
  orders: number;
  cost: number;
  profit: number;
  /** Прибыль / выручка по позициям с себестоимостью; null — считать не от чего. */
  margin: number | null;
  /** Позиции без себестоимости: сколько и на какую выручку. */
  unknown: { items: number; revenue: number };
  /** Позиции, посчитанные по текущей себестоимости (нет снимка продажи). */
  fromCurrent: { items: number };
  products: ProfitProduct[];
  otherCurrencies: Array<{ currency: string; revenue: number; orders: number }>;
};

const cents = (n: number) => Math.round(n * 100) / 100;

export type ProfitOrder = {
  id: number;
  created_at: string;
  total: number | string | null;
  paid_amount: number | string | null;
  currency: string | null;
  status: string;
  fulfillment_kind: string | null;
};
export type ProfitItem = {
  product_id: string | null;
  product_variant_id: string | null;
  name_snapshot: string;
  price_snapshot: number;
  quantity: number;
};

export type ProfitInput = {
  days: number;
  currency: string;
  now: Date;
  tz: string;
  orders: ProfitOrder[];
  items: Map<number, ProfitItem[]>;
  snapshots: Map<number, OrderCostSnapshot>;
  costs: Map<string, ProductCost>;
  variantNames: Map<string, string>;
  refunds: Map<number, { amount: number; restocked: boolean }>;
};

/** Себестоимость по текущим данным: вариант без найденного названия при вариантных суммах — неизвестна. */
function currentUnit(
  c: ProductCost | undefined,
  currency: string,
  it: ProfitItem,
  names: Map<string, string>,
): number | null {
  if (!c || c.currency !== currency) return null;
  return itemUnitCost(c, {
    variantId: it.product_variant_id,
    variantName: it.product_variant_id ? (names.get(it.product_variant_id) ?? null) : null,
    nameSnapshot: it.name_snapshot,
  });
}

export function buildProfit(inp: ProfitInput): ProfitReport {
  const firstDay = dayKeys(inp.days, inp.tz, inp.now)[0]!;
  const rep: ProfitReport = {
    days: inp.days,
    currency: inp.currency,
    revenue: 0,
    orders: 0,
    cost: 0,
    profit: 0,
    margin: null,
    unknown: { items: 0, revenue: 0 },
    fromCurrent: { items: 0 },
    products: [],
    otherCurrencies: [],
  };
  const other = new Map<string, { revenue: number; orders: number }>();
  const byProduct = new Map<string, ProfitProduct>();
  let knownRevenue = 0;

  for (const o of inp.orders) {
    if (dayKey(o.created_at, inp.tz) < firstDay || !includeOrderInAnalytics(o)) continue;
    const gross = analyticsRevenue(o);
    const refund = inp.refunds.get(o.id);
    const net = netOfRefunds(gross, refund?.amount);
    const cur = (o.currency || "").toUpperCase();
    if (cur !== inp.currency) {
      const e = other.get(cur || "—") ?? { revenue: 0, orders: 0 };
      e.revenue += net;
      e.orders += 1;
      other.set(cur || "—", e);
      continue;
    }
    rep.revenue += net;
    rep.orders += 1;
    const items = inp.items.get(o.id) ?? [];
    const snap = inp.snapshots.get(o.id);
    const usableSnap =
      snap && snap.cur === inp.currency && snap.items.length === items.length ? snap : null;
    const weights = items.map((i) => (Number(i.price_snapshot) || 0) * (Number(i.quantity) || 0));
    let sumW = weights.reduce((a, b) => a + b, 0);
    const useQty = sumW <= 0;
    if (useQty) {
      items.forEach((i, k) => (weights[k] = Number(i.quantity) || 0));
      sumW = weights.reduce((a, b) => a + b, 0);
    }
    if (!items.length || sumW <= 0) {
      // Заказ без позиций: выручку отнести не к чему.
      rep.unknown.revenue += net;
      continue;
    }
    const costScale = refund?.restocked ? (gross > 0 ? net / gross : 0) : 1;
    items.forEach((it, k) => {
      const qty = Number(it.quantity) || 0;
      const revenue = (net * weights[k]!) / sumW;
      const key = it.product_id ?? `name:${it.name_snapshot}`;
      const p = byProduct.get(key) ?? {
        key,
        name: it.name_snapshot || "Товар",
        qty: 0,
        revenue: 0,
        cost: 0,
        profit: 0,
        unknownQty: 0,
        unknownRevenue: 0,
      };
      byProduct.set(key, p);
      p.qty += qty;
      p.revenue += revenue;
      let unit = usableSnap?.items[k]?.c ?? null;
      if (unit === null) {
        unit = currentUnit(
          it.product_id ? inp.costs.get(it.product_id) : undefined,
          inp.currency,
          it,
          inp.variantNames,
        );
        if (unit !== null) rep.fromCurrent.items += 1;
      }
      if (unit === null) {
        p.unknownQty += qty;
        p.unknownRevenue += revenue;
        rep.unknown.items += 1;
        rep.unknown.revenue += revenue;
        return;
      }
      const cost = unit * qty * costScale;
      p.cost += cost;
      p.profit += revenue - cost;
      rep.cost += cost;
      knownRevenue += revenue;
    });
  }
  rep.revenue = cents(rep.revenue);
  rep.cost = cents(rep.cost);
  rep.unknown.revenue = cents(rep.unknown.revenue);
  rep.profit = cents(knownRevenue - rep.cost);
  rep.margin = knownRevenue > 0 ? rep.profit / knownRevenue : null;
  rep.products = [...byProduct.values()]
    .map((p) => ({
      ...p,
      revenue: cents(p.revenue),
      cost: cents(p.cost),
      profit: cents(p.profit),
      unknownRevenue: cents(p.unknownRevenue),
    }))
    .sort((a, b) => b.profit - a.profit || b.revenue - a.revenue || a.key.localeCompare(b.key));
  rep.otherCurrencies = [...other.entries()]
    .map(([currency, v]) => ({ currency, revenue: cents(v.revenue), orders: v.orders }))
    .sort((a, b) => b.orders - a.orders || a.currency.localeCompare(b.currency));
  return rep;
}

/** Возвраты с начала периода: сумма и был ли возврат на склад. Постранично, по id. */
async function refundsDetailSince(
  ctx: TenantContext,
  sinceIso: string,
): Promise<Map<number, { amount: number; restocked: boolean }>> {
  const out = new Map<number, { amount: number; restocked: boolean }>();
  await eachPage<{ payload: unknown }>(
    (from, to) =>
      ctx.db
        .from("zernio_logs")
        .select("id, payload")
        .eq("status", ORDER_EVENT_STATUS)
        .eq("event_type", "order.refund")
        .gte("created_at", sinceIso)
        .order("id")
        .range(from, to),
    "возвраты для прибыли",
    (rows) => {
      for (const r of rows) {
        const p = (r.payload ?? {}) as Record<string, unknown>;
        const id = Number(p.order_id);
        if (!Number.isFinite(id)) continue;
        const e = out.get(id) ?? { amount: 0, restocked: false };
        e.amount = cents(e.amount + (Number(p.amount) || 0));
        if (Number(p.restocked) > 0) e.restocked = true;
        out.set(id, e);
      }
    },
  );
  return out;
}

export async function profitReport(
  ctx: TenantContext,
  days: number,
  now = new Date(),
): Promise<ProfitReport> {
  const tz = ctx.timezone;
  const since = new Date(now.getTime() - 2 * days * 86400_000).toISOString();
  const firstDay = dayKeys(days, tz, now)[0]!;
  const currency = await shopCurrency(ctx);
  const [orders, refunds, costs] = await Promise.all([
    pageAll<ProfitOrder>(
      (from, to) =>
        ctx.db
          .from("orders")
          .select("id, created_at, total, paid_amount, currency, status, fulfillment_kind")
          .gte("created_at", since)
          .order("created_at")
          .order("id")
          .range(from, to),
      "заказы для прибыли",
    ),
    refundsDetailSince(ctx, since),
    listCosts(ctx),
  ]);
  const counted = orders.filter(
    (o) => dayKey(o.created_at, tz) >= firstDay && includeOrderInAnalytics(o),
  );
  const ids = counted.map((o) => o.id);
  const items = new Map<number, ProfitItem[]>();
  const variantIds = new Set<string>();
  for (let i = 0; i < ids.length; i += 200) {
    const rows = await pageAll<ProfitItem & { order_id: number }>(
      (from, to) =>
        ctx.db
          .from("order_items")
          .select(
            "order_id, product_id, product_variant_id, name_snapshot, price_snapshot, quantity",
          )
          .in("order_id", ids.slice(i, i + 200))
          .order("order_id")
          .order("id")
          .range(from, to),
      "позиции заказов для прибыли",
    );
    for (const r of rows) {
      const list = items.get(r.order_id) ?? [];
      list.push(r);
      items.set(r.order_id, list);
      if (r.product_variant_id) variantIds.add(r.product_variant_id);
    }
  }
  const variantNames = new Map<string, string>();
  const vids = [...variantIds];
  for (let i = 0; i < vids.length; i += 200) {
    const rows = await pageAll<{ id: string; name: string }>(
      (from, to) =>
        ctx.db
          .from("product_variants")
          .select("id, name")
          .in("id", vids.slice(i, i + 200))
          .order("id")
          .range(from, to),
      "варианты для прибыли",
    );
    for (const v of rows) variantNames.set(v.id, v.name.trim());
  }
  const snapshots = await loadSnapshots(ctx, ids);
  return buildProfit({
    days,
    currency,
    now,
    tz,
    orders,
    items,
    snapshots,
    costs,
    variantNames,
    refunds,
  });
}
