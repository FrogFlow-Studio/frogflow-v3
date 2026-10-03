import { serverFailure } from "@/lib/server-failure";
import type { TenantContext } from "@/core/tenant/resolve.server";

/**
 * Счёт ссылкой из диалога Instagram/WhatsApp (app/admin/invoice.server):
 * заказ в канале покупателя, но оплачивается и выдаётся на странице заказа
 * на сайте, как заказ с сайта. Признак — метка `invoice_link:<заказ>` в
 * app_settings (схема базы не меняется): по ней заказ открывается страницей,
 * истекает через сутки без оплаты и возвращает остаток при отмене.
 */
export const INVOICE_LINK_PREFIX = "invoice_link:";

export async function markInvoiceLink(ctx: TenantContext, orderId: number): Promise<void> {
  const { error } = await ctx.db.from("app_settings").insert({
    bot_id: ctx.tenant.id,
    key: `${INVOICE_LINK_PREFIX}${orderId}`,
    value: "1",
    updated_at: new Date().toISOString(),
  });
  if (error) throw serverFailure(`признак счёта ссылкой для заказа ${orderId}: ${error.message}`);
}

export async function isInvoiceLink(ctx: TenantContext, orderId: number): Promise<boolean> {
  const { data, error: dataError } = await ctx.db
    .from("app_settings")
    .select("key")
    .eq("bot_id", ctx.tenant.id)
    .eq("key", `${INVOICE_LINK_PREFIX}${orderId}`)
    .maybeSingle();
  if (dataError) throw serverFailure(`Заказы: счёт ссылкой: ${dataError.message}`);
  return Boolean(data);
}

/** Заказы-счета ссылкой, выставленные после `since`, — для отмены по сроку. */
export async function invoiceLinkOrderIds(ctx: TenantContext, since: Date): Promise<number[]> {
  const { data, error: dataError } = await ctx.db
    .from("app_settings")
    .select("key")
    .eq("bot_id", ctx.tenant.id)
    .like("key", `${INVOICE_LINK_PREFIX}%`)
    .gt("updated_at", since.toISOString())
    .limit(1000);
  if (dataError) throw serverFailure(`Заказы: счёт ссылкой: ${dataError.message}`);
  return (data ?? [])
    .map((r) => Number(r.key.slice(INVOICE_LINK_PREFIX.length)))
    .filter((n) => Number.isInteger(n) && n > 0);
}
