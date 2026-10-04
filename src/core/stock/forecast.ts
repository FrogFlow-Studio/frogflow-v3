import { pageAll } from "@/core/db/page";
import { includeOrderInAnalytics } from "@/core/analytics/pure";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { chunksOf } from "@/lib/in-chunks";

/**
 * «Хватит на N дней»: остаток товара, делённый на средние продажи в день за
 * последние 30 дней. Считаются только заказы, которые идут в выручку
 * (`includeOrderInAnalytics`: выданные и оплаченные в работе) — отменённые и
 * неоплаченные не в счёт. Остаток у вариантов общий на товар, поэтому продажи
 * всех вариантов суммируются на товар. Нет продаж — прогноза нет (null): это
 * «—», а не деление на ноль.
 */
export const FORECAST_DAYS = 30;
/** Меньше стольких дней — товар попадает в утреннюю сводку. */
export const FORECAST_WARN_DAYS = 7;

export type ForecastStock = { id: string; name: string; stock: number | null };

/** Хватит ли остатка: целых дней (вниз); null — остаток не ведётся или продаж не было. */
export function daysLeft(stock: number | null, sold: number, days = FORECAST_DAYS): number | null {
  if (stock === null || !(sold > 0)) return null;
  if (stock <= 0) return 0;
  return Math.floor((stock * days) / sold);
}

export type ForecastRow = { id: string; name: string; stock: number; sold: number; days: number };

/** Товары, которых хватит меньше чем на `below` дней: сначала самые срочные, дальше по id. */
export function runningOut(
  products: readonly ForecastStock[],
  sold: ReadonlyMap<string, number>,
  below = FORECAST_WARN_DAYS,
): ForecastRow[] {
  const rows: ForecastRow[] = [];
  for (const p of products) {
    const s = sold.get(p.id) ?? 0;
    const d = daysLeft(p.stock, s);
    if (d === null || d >= below) continue;
    rows.push({ id: p.id, name: p.name, stock: p.stock ?? 0, sold: s, days: d });
  }
  return rows.sort((a, b) => a.days - b.days || a.id.localeCompare(b.id));
}

type SaleOrder = {
  id: number;
  status: string;
  fulfillment_kind: string | null;
};

/** Проданное за `days` дней по товарам: количество позиций засчитанных заказов. */
export async function soldByProduct(
  ctx: TenantContext,
  now = new Date(),
  days = FORECAST_DAYS,
): Promise<Map<string, number>> {
  const since = new Date(now.getTime() - days * 86_400_000).toISOString();
  const orders = await pageAll<SaleOrder>(
    (from, to) =>
      ctx.db
        .from("orders")
        .select("id, status, fulfillment_kind")
        .gte("created_at", since)
        .order("id")
        .range(from, to),
    "заказы для прогноза склада",
  );
  const ids = orders.filter(includeOrderInAnalytics).map((o) => o.id);
  const out = new Map<string, number>();
  for (const chunk of chunksOf(ids)) {
    const rows = await pageAll<{ product_id: string | null; quantity: number }>(
      (from, to) =>
        ctx.db
          .from("order_items")
          .select("product_id, quantity")
          .in("order_id", chunk)
          .order("order_id")
          .order("id")
          .range(from, to),
      "позиции заказов для прогноза склада",
    );
    for (const r of rows) {
      if (!r.product_id) continue;
      out.set(r.product_id, (out.get(r.product_id) ?? 0) + (Number(r.quantity) || 0));
    }
  }
  return out;
}

/** Активные физические товары с остатком, постранично. */
async function stockedProducts(ctx: TenantContext): Promise<ForecastStock[]> {
  const rows = await pageAll<{ id: string; name: string; stock_quantity: number | null }>(
    (from, to) =>
      ctx.db
        .from("products")
        .select("id, name, stock_quantity")
        .eq("is_active", true)
        .eq("fulfillment_kind", "physical")
        .not("stock_quantity", "is", null)
        .order("id")
        .range(from, to),
    "товары для прогноза склада",
  );
  return rows.map((r) => ({ id: r.id, name: r.name, stock: r.stock_quantity }));
}

/** Товары, которых хватит меньше чем на неделю (для сводки и заявки поставщику). */
export async function runningOutNow(
  ctx: TenantContext,
  now = new Date(),
  below = FORECAST_WARN_DAYS,
): Promise<ForecastRow[]> {
  if (!ctx.tenant.modules.stock) return [];
  const [products, sold] = await Promise.all([stockedProducts(ctx), soldByProduct(ctx, now)]);
  return runningOut(products, sold, below);
}

/** «Хватит на» для списка товаров: id → дни (товары без прогноза не попадают в карту). */
export async function forecastFor(
  ctx: TenantContext,
  products: readonly ForecastStock[],
  now = new Date(),
): Promise<Record<string, number>> {
  if (!ctx.tenant.modules.stock || products.length === 0) return {};
  const sold = await soldByProduct(ctx, now);
  const out: Record<string, number> = {};
  for (const p of products) {
    const d = daysLeft(p.stock, sold.get(p.id) ?? 0);
    if (d !== null) out[p.id] = d;
  }
  return out;
}
