import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Customer } from "@/core/customers/customers";
import { serverFailure } from "@/lib/server-failure";
import { type OrderWithItems } from "./order-model";

/** Чтение заказов покупателя и повтор заказа. */

export async function getOrder(ctx: TenantContext, id: number): Promise<OrderWithItems | null> {
  const { data, error } = await ctx.db
    .from("orders")
    .select("*, order_items(*)")
    .eq("id", id)
    .maybeSingle();
  if (error) throw serverFailure(`Заказ #${id} не прочитан: ${error.message}`);
  return (data as OrderWithItems | null) ?? null;
}

export async function listCustomerOrders(
  ctx: TenantContext,
  customer: Customer,
  limit = 20,
): Promise<OrderWithItems[]> {
  const { data, error } = await ctx.db
    .from("orders")
    .select("*, order_items(*)")
    .eq("telegram_id", customer.telegramId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit);
  if (error) throw serverFailure(`Заказы покупателя не прочитаны: ${error.message}`);
  return (data ?? []) as OrderWithItems[];
}

/**
 * Все выданные заказы покупателя, новые первыми, — для библиотеки «Мои
 * материалы». Без ограничения по числу: в v1 выборка из последних 80 заказов
 * теряла товары, купленные только раньше. Постранично (PostgREST режет на 1000).
 */
export async function listDeliveredOrders(
  ctx: TenantContext,
  customer: Customer,
): Promise<OrderWithItems[]> {
  const { pageAll } = await import("@/core/db/page");
  return pageAll<OrderWithItems>(
    (from, to) =>
      ctx.db
        .from("orders")
        .select("*, order_items(*)")
        .eq("telegram_id", customer.telegramId)
        .eq("status", "delivered")
        .order("created_at", { ascending: false })
        .range(from, to) as unknown as PromiseLike<{
        data: OrderWithItems[] | null;
        error: { message: string } | null;
      }>,
    "выданные заказы покупателя",
  );
}

export type ReorderReport = {
  /** Сколько единиц товара положили в корзину. */
  added: number;
  /** Позиции, которых нет или стало меньше: «хотели — получили». Цены не копируются: корзина считает по текущим. */
  short: Array<{ name: string; wanted: number; got: number }>;
};

/**
 * «Повторить заказ»: те же товары снова в корзину — по одному вызову на
 * единицу количества (addToCart считает остаток и лимиты), цена и наличие
 * берутся текущие, не из старого заказа. Что не нашлось или стало меньше —
 * в `short`, чтобы покупателю назвать это, а не молчать.
 */
export async function reorderReport(
  ctx: TenantContext,
  customer: Customer,
  order: OrderWithItems,
): Promise<ReorderReport> {
  const { addToCart } = await import("@/core/cart/cart");
  const { mergeOrderItems } = await import("@/core/offers/offers");
  const report: ReorderReport = { added: 0, short: [] };
  // Строки «по акции» и «по полной» одного товара — вместе: потолок 20 штук на товар, не на строку.
  for (const item of mergeOrderItems(order.order_items)) {
    if (!item.product_id) continue;
    const wanted = Math.min(Number(item.quantity) || 1, 20);
    let got = 0;
    for (let i = 0; i < wanted; i++)
      if ((await addToCart(ctx, customer, item.product_id, item.product_variant_id)) === "ok")
        got++;
    report.added += got;
    if (got < wanted)
      report.short.push({ name: item.name_snapshot.replace(/\u2063/g, ""), wanted, got });
  }
  return report;
}

/** То же без подробностей: сколько единиц добавлено. */
export async function reorderIntoCart(
  ctx: TenantContext,
  customer: Customer,
  order: OrderWithItems,
): Promise<number> {
  return (await reorderReport(ctx, customer, order)).added;
}

/** Открытый заказ, ждущий чек, не старше суток — запасной путь, если состояние потерялось. */
export async function recentAwaitingPaymentOrder(
  ctx: TenantContext,
  customer: Customer,
  windowMs = 24 * 3600_000,
): Promise<number | null> {
  const since = new Date(Date.now() - windowMs).toISOString();
  const { data, error } = await ctx.db
    .from("orders")
    .select("id")
    .eq("telegram_id", customer.telegramId)
    .eq("status", "awaiting_payment")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw serverFailure(`Неоплаченный заказ не прочитан: ${error.message}`);
  return data?.id ?? null;
}

/** Окно, в котором «Купить» того же товара — скорее повтор, чем новая покупка. */
export const RECENT_BOUGHT_WINDOW_MS = 3 * 86_400_000;

/** Статусы заказа «оплачен или чек на проверке» — второй заказ на тот же товар не нужен. */
export const BOUGHT_STATUSES = [
  "awaiting_confirmation",
  "paid",
  "delivering",
  "delivered",
] as const;

/**
 * Свежий (за RECENT_BOUGHT_WINDOW_MS) цифровой заказ покупателя с этим
 * товаром, оплаченный, выданный или с чеком на проверке, — новые первыми.
 * После выдачи #221 покупательница снова нажала «Купить» и получила второй
 * заказ #222 «К оплате» (Копилка 14.10). null — такого нет.
 */
export async function recentBoughtOrderWith(
  ctx: TenantContext,
  customer: Customer,
  productId: string,
  windowMs = RECENT_BOUGHT_WINDOW_MS,
): Promise<OrderWithItems | null> {
  const { pageAll } = await import("@/core/db/page");
  const since = new Date(Date.now() - windowMs).toISOString();
  const rows = await pageAll<OrderWithItems>(
    (from, to) =>
      ctx.db
        .from("orders")
        .select("*, order_items(*)")
        .eq("telegram_id", customer.telegramId)
        .in("status", [...BOUGHT_STATUSES])
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .range(from, to) as unknown as PromiseLike<{
        data: OrderWithItems[] | null;
        error: { message: string } | null;
      }>,
    "оплаченные заказы покупателя не прочитаны",
  );
  return (
    rows.find(
      (o) =>
        o.fulfillment_kind !== "physical" &&
        (o.order_items ?? []).some((i) => i.product_id === productId),
    ) ?? null
  );
}
