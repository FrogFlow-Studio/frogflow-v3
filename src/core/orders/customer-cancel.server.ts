import type { Customer } from "@/core/customers/customers";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { serverFailure } from "@/lib/server-failure";
import { displayNo } from "./pure";
import { getOrder, rejectOrder } from "./orders";

export type CustomerCancelResult =
  | { kind: "cancelled" | "already_cancelled"; orderId: number; orderNumber: number }
  | { kind: "not_found" | "ambiguous"; orderNumber: number }
  | { kind: "not_cancellable"; orderNumber: number; status: string };

/**
 * Отменяет конкретный заказ самого покупателя только пока он ожидает оплаты и
 * в нём нет внесённых денег. Финальная запись — CAS в rejectOrder, поэтому
 * оплата, пришедшая одновременно с отменой, не может быть потеряна.
 */
export async function cancelCustomerOrder(
  ctx: TenantContext,
  customer: Customer,
  orderNumber: number,
): Promise<CustomerCancelResult> {
  if (!Number.isSafeInteger(orderNumber) || orderNumber <= 0)
    return { kind: "not_found", orderNumber };

  const { data, error } = await ctx.db
    .from("orders")
    .select("id, bot_id, telegram_id, order_no, display_no, status, paid_amount")
    .eq("bot_id", ctx.tenant.id)
    .eq("telegram_id", customer.telegramId)
    .or(`display_no.eq.${orderNumber},order_no.eq.${orderNumber},id.eq.${orderNumber}`);
  if (error) throw serverFailure(`Заказ покупателя №${orderNumber} не найден: ${error.message}`);

  const matches = (
    (data ?? []) as Array<{
      id: number;
      bot_id: string;
      telegram_id: number;
      order_no: number;
      display_no: number | null;
      status: string;
      paid_amount: number | null;
    }>
  ).filter((row) => displayNo(row) === orderNumber);
  if (matches.length === 0) return { kind: "not_found", orderNumber };
  if (matches.length > 1) return { kind: "ambiguous", orderNumber };

  const order = matches[0]!;
  if (order.status === "cancelled")
    return { kind: "already_cancelled", orderId: order.id, orderNumber };
  if (order.status !== "awaiting_payment" || Number(order.paid_amount) > 0)
    return { kind: "not_cancellable", orderNumber, status: order.status };

  const changed = await rejectOrder(ctx, order.id, "buyer", {
    from: ["awaiting_payment"],
    to: "cancelled",
    restoreStock: true,
  });
  if (changed) return { kind: "cancelled", orderId: order.id, orderNumber };

  // Если оплата/чек/другая операция выиграла гонку, сообщаем только свежий статус.
  const fresh = await getOrder(ctx, order.id);
  if (
    fresh?.bot_id === ctx.tenant.id &&
    fresh.telegram_id === customer.telegramId &&
    fresh.status === "cancelled"
  ) {
    return { kind: "already_cancelled", orderId: fresh.id, orderNumber };
  }
  return {
    kind: "not_cancellable",
    orderNumber,
    status: fresh?.status ?? "unknown",
  };
}
