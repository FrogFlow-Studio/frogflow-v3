/** Данные для «Что продвигать»: активные товары, одобренные оценки и продажи за окно (core/analytics/promote). */
import type { TenantContext } from "@/core/tenant/resolve.server";
import { pageAll } from "@/core/db/page";
import { includeOrderInAnalytics } from "./pure";
import { promoteHints, PROMOTE, type PromoteHints, type PromoteItem } from "./promote";

const CHUNK = 200;

export async function loadPromoteHints(
  ctx: TenantContext,
  now = new Date(),
): Promise<PromoteHints> {
  const since = new Date(now.getTime() - PROMOTE.windowDays * 86_400_000).toISOString();
  const products = await pageAll(
    (a, b) =>
      ctx.db
        .from("products")
        .select("id, name, stock_quantity")
        .eq("is_active", true)
        .order("id")
        .range(a, b),
    "товары для подсказок",
  );
  if (products.length === 0) return promoteHints([]);

  const orders = await pageAll(
    (a, b) =>
      ctx.db
        .from("orders")
        .select("id, status, fulfillment_kind")
        .gte("created_at", since)
        .lte("created_at", now.toISOString())
        .order("id")
        .range(a, b),
    "заказы для подсказок",
  );
  const paid = orders.filter(includeOrderInAnalytics).map((o) => o.id);
  const sold = new Map<string, number>();
  for (let i = 0; i < paid.length; i += CHUNK) {
    const chunk = paid.slice(i, i + CHUNK);
    const items = await pageAll(
      (a, b) =>
        ctx.db
          .from("order_items")
          .select("product_id, quantity")
          .in("order_id", chunk)
          .order("order_id")
          .order("id")
          .range(a, b),
      "позиции заказов для подсказок",
    );
    for (const it of items)
      if (it.product_id)
        sold.set(it.product_id, (sold.get(it.product_id) ?? 0) + (it.quantity ?? 0));
  }

  const { approvedRatings } = await import("@/core/reviews/photos.server");
  const ratings = await approvedRatings(
    ctx,
    products.map((p) => p.id),
  );
  const tracksStock = Boolean(ctx.tenant.modules.stock);
  const items: PromoteItem[] = products.map((p) => ({
    id: p.id,
    name: p.name,
    stock: tracksStock ? p.stock_quantity : null,
    rating: ratings.get(p.id) ?? null,
    sold: sold.get(p.id) ?? 0,
  }));
  return promoteHints(items);
}
