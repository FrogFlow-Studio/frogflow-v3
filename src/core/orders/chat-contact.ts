import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Customer } from "@/core/customers/customers";
import { serverFailure } from "@/lib/server-failure";

/** Заказ, к которому относится номер из переписки: не старше недели. */
export const CHAT_CONTACT_WINDOW_MS = 7 * 24 * 3600_000;

/**
 * Номер, присланный покупателем в переписке, — в последний его заказ за неделю,
 * если у заказа телефона ещё нет. Условие `contact is null`: номер, введённый
 * при оформлении или продавцом, не затирается. Отменённые и отклонённые заказы
 * не берём. Возвращает номер заказа для уведомления продавцу (`saved` — номер
 * записан в заказ) или null, если свежего заказа нет.
 */
export async function noteOrderContact(
  ctx: TenantContext,
  customer: Customer,
  phone: string,
  now = Date.now(),
): Promise<{ no: number; saved: boolean } | null> {
  const since = new Date(now - CHAT_CONTACT_WINDOW_MS).toISOString();
  const { data, error } = await ctx.db
    .from("orders")
    .select("id, order_no, display_no, contact")
    .eq("telegram_id", customer.telegramId)
    .not("status", "in", "(cancelled,rejected)")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw serverFailure(`Последний заказ покупателя не прочитан: ${error.message}`);
  if (!data) return null;
  const no = data.display_no ?? data.order_no;
  if (data.contact) return { no, saved: data.contact === phone };
  const { data: written, error: werr } = await ctx.db
    .from("orders")
    .update({ contact: phone })
    .eq("id", data.id)
    .is("contact", null)
    .select("id");
  if (werr) throw serverFailure(`Телефон в заказ #${no} не записан: ${werr.message}`);
  return { no, saved: Boolean(written?.length) };
}
