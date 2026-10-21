import type { Tenant } from "@/core/tenant/types";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { PayRemindHold, PayReminder, PayReminderOrder } from "@/core/orders/pay-remind";
import type { Locale } from "@/core/i18n/locale";

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
      const text = (await humanReminderText(ctx, r)) ?? (await reminderText(ctx, r));
      return notifyCustomer(ctx, order, text);
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

/**
 * Персонализированное уважительное напоминание для WhatsApp и Direct (Retention Engine).
 * Если известно имя покупателя, вместо шаблонного сухого текста формирует обращение:
 * «Айгерим, добрый день! Заметили ваш заказ #101 («...») на сумму 15 000 ₸.
 * Если возникли сложности или нужно подсказать по доставке — напишите сюда...»
 */
export async function humanReminderText(
  ctx: TenantContext,
  r: PayReminder,
): Promise<string | null> {
  // Для Telegram-бота оставляем структурированный HTML reminderText
  if (r.platform === "telegram") return null;

  const { getCustomerByTelegramId } = await import("@/core/customers/customers");
  const { formatMoney } = await import("@/core/money/money");
  const { isLocale } = await import("@/core/i18n/locale");

  const buyer = await getCustomerByTelegramId(ctx, r.telegramId).catch(() => null);
  const name = buyer?.firstName?.trim();
  if (!name) return null;

  const locale: Locale = isLocale(buyer?.state?.locale)
    ? (buyer.state.locale as Locale)
    : (ctx.tenant.settings.default_locale ?? "ru");

  const { data: items } = await ctx.db
    .from("order_items")
    .select("name_snapshot")
    .eq("order_id", r.orderId)
    .limit(3);

  const itemNames = (items ?? [])
    .map((i: { name_snapshot?: string | null }) => i.name_snapshot?.trim())
    .filter(Boolean) as string[];

  const itemSummary = itemNames.length > 0 ? ` («${itemNames.join(", ")}»)` : "";
  const amount = formatMoney(r.due, r.currency);

  if (locale === "kk") {
    return `${name}, қайырлы күн! Сіздің #${r.no}${itemSummary} сомасы ${amount} болатын тапсырысыңызды байқадық.

Тапсырыс немесе жеткізу бойынша сұрақтарыңыз болса — осында жазыңыз, көмектесуге дайынбыз!

${r.instructions ? `${r.instructions}\n\n` : ""}Төлем жасаған соң чекті осында жіберіңіз — бірден дайындауға кірісеміз.`;
  }

  if (locale === "uz") {
    return `${name}, xayrli kun! #${r.no}${itemSummary} raqamli ${amount} miqdoridagi buyurtmangizni ko'rdik.

Buyurtma yoki yetkazib berish bo‘yicha savollaringiz bo‘lsa — shu yerga yozing, yordam berishdan mamnun bo'lamiz!

${r.instructions ? `${r.instructions}\n\n` : ""}To‘lovdan so‘ng chekni shu yerga yuboring — buyurtmani darhol tayyorlashga kirishamiz.`;
  }

  if (locale === "en") {
    return `Hello ${name}! We noticed your order #${r.no}${itemSummary} for ${amount}.

If you have any questions about the items, shipping, or payment — feel free to reply here, we're happy to help!

${r.instructions ? `${r.instructions}\n\n` : ""}Once paid, please send the receipt here and we'll process your order right away.`;
  }

  return `${name}, добрый день! Заметили ваш заказ #${r.no}${itemSummary} на сумму ${amount}.

Если возникли вопросы по заказу, доставке или оплате — напишите сюда, с радостью подскажем!

${r.instructions ? `${r.instructions}\n\n` : ""}После оплаты отправьте сюда чек — сразу передадим заказ в работу.`;
}
