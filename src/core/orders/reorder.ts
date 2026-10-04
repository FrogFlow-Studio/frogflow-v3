import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Customer } from "@/core/customers/customers";
import { serverFailure } from "@/lib/server-failure";
import { REFUNDABLE_STATUSES } from "./refund";
import type { OrderWithItems } from "./orders";

/**
 * Последний оплаченный заказ покупателя — то, что можно «повторить как в
 * прошлый раз». Оплаченный — там, где деньги у продавца (REFUNDABLE_STATUSES):
 * отклонённый и отменённый заказ повтором не служит. Одна строка с уникальным
 * ключом сортировки; ошибка чтения — serverFailure, а не «заказов нет».
 */
export async function lastPaidOrder(
  ctx: TenantContext,
  customer: Customer,
): Promise<OrderWithItems | null> {
  const { data, error } = await ctx.db
    .from("orders")
    .select("*, order_items(*)")
    .eq("telegram_id", customer.telegramId)
    .in("status", [...REFUNDABLE_STATUSES])
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw serverFailure(`Прошлый заказ не прочитан: ${error.message}`);
  return (data as OrderWithItems | null) ?? null;
}

/** Подписи недостающих позиций для сообщения: «Название» (нет совсем) или «Название (2/3)» (меньше). */
export function shortLabels(short: Array<{ name: string; wanted: number; got: number }>): string[] {
  return short.map((x) => (x.got === 0 ? x.name : `${x.name} (${x.got}/${x.wanted})`));
}
