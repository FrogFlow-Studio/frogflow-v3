import type { TenantContext } from "@/core/tenant/resolve.server";
import { claimLowStock, lowStockText, sellerLocale } from "@/core/catalog/low-stock";
import { escapeHtml } from "./copy";
import { notifyAdminsHtml } from "./notify";

/**
 * «Заканчивается на складе» — одно сообщение продавцу по каждому товару заказа,
 * у которого остаток упал до порога (core/catalog/low-stock). Зовётся из
 * уведомления о заказе: через него проходят заказы всех каналов (бот, сайт,
 * Instagram/WhatsApp). Сбой сообщения заказ и его уведомление не срывает.
 * Отметка «уже сообщали» ставится до отправки. Не дошло до Telegram — notifyAdminsHtml
 * кладёт сообщение в очередь исходящих (sendOrEnqueue), крон повторит. Сбой раньше очереди
 * (чтение настроек уведомлений) повтора не даёт: отметка остаётся, сообщения не будет.
 */
export async function notifyLowStock(
  ctx: TenantContext,
  order: { order_items?: Array<{ product_id: string | null }> | null },
): Promise<number> {
  try {
    const ids = (order.order_items ?? [])
      .map((i) => i.product_id)
      .filter((id): id is string => Boolean(id));
    const items = await claimLowStock(ctx, ids);
    if (items.length === 0) return 0;
    const locale = await sellerLocale(ctx);
    for (const item of items)
      await notifyAdminsHtml(ctx, lowStockText(locale, item, escapeHtml(item.name)), {
        kind: "low_stock",
      });
    return items.length;
  } catch (e) {
    console.warn(`[tg:${ctx.tenant.id}] «заканчивается на складе»: ${String(e)}`);
    return 0;
  }
}
