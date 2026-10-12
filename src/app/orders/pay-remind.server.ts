import type { Tenant } from "@/core/tenant/types";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { PayRemindHold, PayReminder, PayReminderOrder } from "@/core/orders/pay-remind";

/**
 * Крон: напоминание об оплате заказов из бота, Instagram и WhatsApp
 * (core/orders/pay-remind) — текстом на языке покупателя, в его канал через
 * notifyCustomer. Telegram — HTML, Instagram/WhatsApp — без тегов.
 */
export async function runChatPayReminders(tenant: Tenant) {
  const { tenantContext } = await import("@/core/tenant/resolve.server");
  const ctx = tenantContext(tenant);
  const { remindChatOrders } = await import("@/core/orders/pay-remind");
  return remindChatOrders(
    ctx,
    async (r) => {
      const { getOrder } = await import("@/core/orders/orders");
      const order = await getOrder(ctx, r.orderId);
      if (!order) return false;
      const { notifyCustomer } = await import("@/app/admin/admin.server");
      return notifyCustomer(ctx, order, await reminderText(ctx, r));
    },
    undefined,
    (o, why) => heldNotice(ctx, o, why),
  );
}

/**
 * Напоминание придержано (обращение покупателя или более поздний заказ):
 * продавцу — одно сообщение со ссылкой на заказ, «отмените или подтвердите».
 */
export async function heldNotice(
  ctx: TenantContext,
  o: PayReminderOrder,
  why: PayRemindHold,
): Promise<void> {
  const { escapeHtml } = await import("@/channels/telegram/copy");
  const { noticeLocale } = await import("@/core/helpdesk/seller-texts");
  const { getCustomerByTelegramId } = await import("@/core/customers/customers");
  const { payRemindHeldText } = await import("@/core/orders/pay-remind-hold-texts");
  const { notifyAdminsHtml } = await import("@/channels/telegram/notify");
  const buyer = await getCustomerByTelegramId(ctx, Number(o.telegram_id)).catch(() => null);
  const who = buyer?.username ? `@${buyer.username}` : (buyer?.firstName ?? "—");
  await notifyAdminsHtml(
    ctx,
    payRemindHeldText(
      await noticeLocale(ctx),
      o.display_no ?? o.order_no,
      why,
      escapeHtml(who),
      `${ctx.appUrl}/admin/orders/${o.id}`,
    ),
    { orderId: o.id, kind: "new_order" },
  );
}

/**
 * Текст напоминания: сумма к оплате, реквизиты и просьба прислать чек; у
 * счёта ссылкой (#194) — ссылка на страницу заказа, где оплата и чек.
 */
export async function reminderText(ctx: TenantContext, r: PayReminder): Promise<string> {
  const { COPY, escapeHtml } = await import("@/channels/telegram/copy");
  const { getCustomerByTelegramId } = await import("@/core/customers/customers");
  const { isLocale } = await import("@/core/i18n/locale");
  const { formatMoney } = await import("@/core/money/money");
  const buyer = await getCustomerByTelegramId(ctx, r.telegramId);
  const locale = isLocale(buyer?.state.locale)
    ? buyer.state.locale
    : (ctx.tenant.settings.default_locale ?? "ru");
  const m = COPY[locale] ?? COPY.ru;
  const deposit =
    r.due < r.total
      ? `\n${m.payReminderDeposit(formatMoney(r.due, r.currency), formatMoney(r.total, r.currency))}`
      : "";
  const head = `${m.payReminderTitle(r.no)}\n\n${m.payReminderAmount(formatMoney(r.due, r.currency))}${deposit}\n\n`;
  const { orderPageUrl } = await import("@/core/storefront/web-order");
  const url = r.invoiceLink ? await orderPageUrl(ctx, r.orderId) : null;
  const body = url
    ? m.payReminderLink(escapeHtml(url))
    : `${r.instructions ? escapeHtml(r.instructions) : m.payReminderNoDetails}\n\n${m.payReminderAfter}`;
  const html = head + body;
  if (r.platform === "telegram") return html;
  const { plain } = await import("@/channels/zernio/shop-flow");
  return plain(html);
}
