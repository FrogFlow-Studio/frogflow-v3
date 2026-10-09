import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Database } from "@/core/db-types";
import { serverFailure } from "@/lib/server-failure";

/** Строки заказа, статусы и способы оплаты. */

export type OrderRow = Database["public"]["Tables"]["orders"]["Row"];

export type OrderItemRow = Database["public"]["Tables"]["order_items"]["Row"];

export type OrderWithItems = OrderRow & { order_items: OrderItemRow[] };

export type PaymentMethodRow = Database["public"]["Tables"]["payment_methods"]["Row"];

export const DELIVERABLE_STATUSES = ["awaiting_payment", "awaiting_confirmation", "paid"] as const;

/** Чек принимается, только пока заказ ждёт оплаты. */
export const PROOF_STATUSES = ["awaiting_payment", "awaiting_confirmation"] as const;

export const REJECTABLE_STATUSES = [
  ...DELIVERABLE_STATUSES,
  "accepted",
  "in_production",
  "ready",
] as const;

export async function listActivePaymentMethods(ctx: TenantContext): Promise<PaymentMethodRow[]> {
  const { data, error } = await ctx.db
    .from("payment_methods")
    .select("*")
    .eq("is_active", true)
    .order("sort_order");
  if (error) throw serverFailure(`Способы оплаты не прочитаны: ${error.message}`);
  return data ?? [];
}

export async function paymentMethodFor(
  ctx: TenantContext,
  countryCode: string,
): Promise<PaymentMethodRow | null> {
  const { data, error } = await ctx.db
    .from("payment_methods")
    .select("*")
    .eq("country_code", countryCode)
    .eq("is_active", true)
    .order("sort_order")
    .limit(1)
    .maybeSingle();
  if (error) throw serverFailure(`Способ оплаты для ${countryCode} не прочитан: ${error.message}`);
  return data ?? null;
}
