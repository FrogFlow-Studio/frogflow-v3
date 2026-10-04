import { pageAll } from "@/core/db/page";
import { includeOrderInAnalytics } from "@/core/analytics/pure";
import { shopCurrency } from "@/core/discounts/discounts";
import { listCosts, unitCost, type ProductCost } from "@/core/profit/cost";
import { STALE_DEFAULT_DAYS, STALE_MAX_DAYS, STALE_MIN_DAYS } from "./stale-const";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { chunksOf } from "@/lib/in-chunks";

/**
 * Залежавшийся товар: есть остаток, а продаж за последние N дней не было
 * (по умолчанию 60). Продажа — позиция заказа, который идёт в выручку
 * (`includeOrderInAnalytics`); отменённые и неоплаченные не в счёт. Остаток
 * общий на товар, поэтому продажа любого варианта снимает товар с отчёта.
 * Товар, заведённый меньше N дней назад, ещё не залежался: у него просто не
 * было времени продаваться. «Заморожено» — остаток × себестоимость товара в
 * валюте магазина; себестоимость не задана — товар в отчёте есть, а в сумму не
 * входит (считается отдельно).
 */
export type StaleProduct = {
  id: string;
  name: string;
  stock: number;
  /** Себестоимость штуки; null — не задана. */
  unitCost: number | null;
  /** stock × unitCost; null — себестоимость не задана. */
  frozen: number | null;
  createdAt: string;
};

export type StaleReport = {
  days: number;
  currency: string;
  products: StaleProduct[];
  /** Сумма «заморожено» по товарам с известной себестоимостью. */
  frozenTotal: number;
  /** Товаров без себестоимости: их деньги в сумму не входят. */
  unknownCost: number;
};

type Candidate = { id: string; name: string; stock_quantity: number | null; created_at: string };

const cents = (n: number) => Math.round(n * 100) / 100;

/** Чистая часть: отбор залежавшихся и сумма «заморожено». */
export function buildStale(inp: {
  days: number;
  now: Date;
  currency: string;
  candidates: readonly Candidate[];
  soldIds: ReadonlySet<string>;
  costs: ReadonlyMap<string, ProductCost>;
}): StaleReport {
  const cutoff = inp.now.getTime() - inp.days * 86_400_000;
  const products: StaleProduct[] = [];
  for (const p of inp.candidates) {
    const stock = p.stock_quantity ?? 0;
    if (stock <= 0 || inp.soldIds.has(p.id)) continue;
    if (Date.parse(p.created_at) > cutoff) continue;
    const c = inp.costs.get(p.id) ?? null;
    const unit = c && c.currency === inp.currency ? unitCost(c, null) : null;
    products.push({
      id: p.id,
      name: p.name,
      stock,
      unitCost: unit,
      frozen: unit === null ? null : cents(unit * stock),
      createdAt: p.created_at,
    });
  }
  products.sort(
    (a, b) => (b.frozen ?? -1) - (a.frozen ?? -1) || b.stock - a.stock || a.id.localeCompare(b.id),
  );
  return {
    days: inp.days,
    currency: inp.currency,
    products,
    frozenTotal: cents(products.reduce((s, p) => s + (p.frozen ?? 0), 0)),
    unknownCost: products.filter((p) => p.frozen === null).length,
  };
}

/** Товары, проданные за `days` дней (по засчитанным заказам). */
async function soldProductIds(ctx: TenantContext, now: Date, days: number): Promise<Set<string>> {
  const since = new Date(now.getTime() - days * 86_400_000).toISOString();
  const orders = await pageAll<{ id: number; status: string; fulfillment_kind: string | null }>(
    (from, to) =>
      ctx.db
        .from("orders")
        .select("id, status, fulfillment_kind")
        .gte("created_at", since)
        .order("id")
        .range(from, to),
    "заказы для отчёта о залежавшемся",
  );
  const out = new Set<string>();
  for (const chunk of chunksOf(orders.filter(includeOrderInAnalytics).map((o) => o.id))) {
    const rows = await pageAll<{ product_id: string | null }>(
      (from, to) =>
        ctx.db
          .from("order_items")
          .select("product_id")
          .in("order_id", chunk)
          .order("order_id")
          .order("id")
          .range(from, to),
      "позиции заказов для отчёта о залежавшемся",
    );
    for (const r of rows) if (r.product_id) out.add(r.product_id);
  }
  return out;
}

export async function staleReport(
  ctx: TenantContext,
  days = STALE_DEFAULT_DAYS,
  now = new Date(),
): Promise<StaleReport> {
  const d = Math.min(
    Math.max(Math.floor(days) || STALE_DEFAULT_DAYS, STALE_MIN_DAYS),
    STALE_MAX_DAYS,
  );
  const [candidates, soldIds, costs, currency] = await Promise.all([
    pageAll<Candidate>(
      (from, to) =>
        ctx.db
          .from("products")
          .select("id, name, stock_quantity, created_at")
          .eq("is_active", true)
          .eq("fulfillment_kind", "physical")
          .gt("stock_quantity", 0)
          .order("id")
          .range(from, to),
      "товары для отчёта о залежавшемся",
    ),
    soldProductIds(ctx, now, d),
    listCosts(ctx),
    shopCurrency(ctx),
  ]);
  return buildStale({ days: d, now, currency, candidates, soldIds, costs });
}
