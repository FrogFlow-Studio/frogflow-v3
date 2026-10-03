import { inChunks } from "@/lib/in-chunks";
import type { OrderWithItems } from "@/core/orders/orders";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { storeProductsByIds } from "./catalog";

/**
 * «Повторить заказ» в Mini App и на витрине. Корзина витрины живёт в
 * браузере покупателя, поэтому сервер не кладёт позиции сам, а отдаёт план:
 * что добавить (с сегодняшними названием и ценой) и чего не будет и почему.
 * Правила те же, что у кнопки в боте (`reorderIntoCart` → `addToCart`):
 * снятое с продажи, скрытое, без варианта и сверх остатка не попадает.
 */
export type ReorderLine = {
  productId: string;
  variantId: string | null;
  name: string;
  price: number;
  currency: string;
  image: string | null;
  qty: number;
  kind: "digital" | "physical";
};

/**
 * gone — снят с продажи или недоступен; variant_gone — варианта больше нет
 * (или у товара появились варианты): выбрать заново на странице товара;
 * out_of_stock — остаток нулевой; less — взяли не всё, `left` сколько добавлено.
 */
export type ReorderSkipReason = "gone" | "variant_gone" | "out_of_stock" | "less";

export type ReorderSkip = { name: string; reason: ReorderSkipReason; left?: number };

export type ReorderPlan = { lines: ReorderLine[]; skipped: ReorderSkip[] };

/** Столько единиц одной позиции кладёт и кнопка в боте. */
export const REORDER_MAX_QTY = 20;

export async function planReorder(
  ctx: TenantContext,
  order: Pick<OrderWithItems, "order_items">,
): Promise<ReorderPlan> {
  const items = order.order_items ?? [];
  const ids = [...new Set(items.flatMap((i) => (i.product_id ? [i.product_id] : [])))];
  const [products, stockRows] = await Promise.all([
    storeProductsByIds(ctx, ids),
    ctx.tenant.modules.stock && ids.length
      ? inChunks(
          ids,
          (chunk) => ctx.db.from("products").select("id, stock_quantity").in("id", chunk),
          "Повтор заказа: остатки",
        )
      : Promise.resolve([]),
  ]);
  const byId = new Map(products.map((p) => [p.id, p]));
  // Остаток общий на товар, а позиций с ним в заказе может быть несколько (варианты).
  const left = new Map<string, number>();
  for (const r of stockRows)
    if (r.stock_quantity != null) left.set(r.id, Math.max(0, Number(r.stock_quantity)));

  const courses = Boolean(ctx.tenant.modules.courses);
  const { courseEnrollOpen } = courses
    ? await import("@/core/courses/enroll.server")
    : { courseEnrollOpen: null };

  const lines: ReorderLine[] = [];
  const skipped: ReorderSkip[] = [];
  for (const item of items) {
    const name = item.name_snapshot;
    const p = item.product_id ? byId.get(item.product_id) : undefined;
    if (!p) {
      skipped.push({ name, reason: "gone" });
      continue;
    }
    if (p.kind === "digital" && courseEnrollOpen && !(await courseEnrollOpen(ctx, p.id))) {
      skipped.push({ name, reason: "gone" });
      continue;
    }
    const variant = item.product_variant_id
      ? p.variants.find((v) => v.id === item.product_variant_id)
      : undefined;
    // Нужный вариант исчез или товар обзавёлся вариантами: цену «от» не подставляем.
    if ((item.product_variant_id && !variant) || (!item.product_variant_id && p.variants.length)) {
      skipped.push({ name, reason: "variant_gone" });
      continue;
    }
    const want = p.kind === "digital" ? 1 : Math.max(1, Number(item.quantity) || 1);
    let qty = Math.min(want, REORDER_MAX_QTY);
    const stock = left.get(p.id);
    if (stock !== undefined) {
      if (stock <= 0) {
        skipped.push({ name, reason: "out_of_stock" });
        continue;
      }
      qty = Math.min(qty, stock);
      left.set(p.id, stock - qty);
    }
    if (qty < want) skipped.push({ name, reason: "less", left: qty });
    lines.push({
      productId: p.id,
      variantId: variant?.id ?? null,
      name: variant ? `${p.name} (${variant.name})` : p.name,
      price: variant ? variant.price : p.price,
      currency: variant ? variant.currency : p.currency,
      image: p.images[0] ?? null,
      qty,
      kind: p.kind,
    });
  }
  return { lines, skipped };
}

/**
 * План повтора для заказа покупателя из Telegram (Mini App, вход на сайте):
 * свой заказ — по telegram_id или привязанный с сайта по подписанной ссылке
 * (core/storefront/web-link). Чужой номер или несуществующий — null, без
 * подсказки, какой из двух случаев.
 */
export async function planReorderForBuyer(
  ctx: TenantContext,
  telegramId: number,
  orderId: number,
): Promise<ReorderPlan | null> {
  const { getOrder } = await import("@/core/orders/orders");
  const order = await getOrder(ctx, orderId);
  if (!order) return null;
  if (order.telegram_id !== telegramId) {
    const { getCustomerByTelegramId } = await import("@/core/customers/customers");
    const { linkedWebOrderIds } = await import("./web-link");
    const customer = await getCustomerByTelegramId(ctx, telegramId);
    if (
      !customer ||
      order.platform !== "web" ||
      !linkedWebOrderIds(customer.state).includes(orderId)
    )
      return null;
  }
  return planReorder(ctx, order);
}
