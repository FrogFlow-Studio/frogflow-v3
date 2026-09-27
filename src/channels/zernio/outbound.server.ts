import type { TenantContext } from "@/core/tenant/resolve.server";
import { orderChannel } from "@/core/orders/pure";
import { getCustomer, getCustomerByTelegramId, type Customer } from "@/core/customers/customers";
import type { MaterialSender } from "@/core/orders/orders";
import {
  describeSendError,
  liveTransport,
  startWhatsAppConversation,
  type ZernioTransport,
} from "./api.server";
import { zernioMaterialSender } from "./deliver";
import { isZernioPlatform, type ZernioPlatform } from "./platform";
import { plain } from "./shop-flow";

/** Куда писать покупателю из Instagram/WhatsApp — по его записи в bot_users. */
export type ZernioTarget = {
  conversationId: string;
  accountId: string;
  platform: ZernioPlatform;
  /** Номер WhatsApp — чтобы написать первым, когда 24-часовое окно закрылось. */
  phone?: string | null;
};

export function zernioTargetOf(customer: Customer | null): ZernioTarget | null {
  if (!customer || !isZernioPlatform(customer.platform)) return null;
  if (!customer.zernioConversationId || !customer.zernioAccountId) return null;
  return {
    conversationId: customer.zernioConversationId,
    accountId: customer.zernioAccountId,
    platform: customer.platform,
    phone: customer.contactPhone,
  };
}

/** Покупатель заказа: по user_key, а для старых строк без него — по telegram_id. */
export async function zernioTargetForOrder(
  ctx: TenantContext,
  order: { user_key: string | null; telegram_id: number; platform: string },
): Promise<ZernioTarget | null> {
  if (orderChannel(order.platform) !== "zernio") return null;
  const customer = order.user_key
    ? await getCustomer(ctx, order.user_key)
    : await getCustomerByTelegramId(ctx, Number(order.telegram_id));
  return zernioTargetOf(customer);
}

/** Текст покупателю в его канал (HTML снимается — Direct его не рисует). */
export async function sendToZernioTarget(
  target: ZernioTarget,
  html: string,
  transport: ZernioTransport = liveTransport,
): Promise<boolean> {
  const r = await transport.send(target.conversationId, target.accountId, plain(html), {
    platform: target.platform,
  });
  return r.ok;
}

export function zernioSenderFor(
  target: ZernioTarget,
  transport: ZernioTransport = liveTransport,
): MaterialSender {
  return zernioMaterialSender(transport, target.conversationId, target.accountId, target.platform);
}

/** Заказ для выдачи в канал: номер для текста, почта для письма при закрытом окне. */
export type DeliveryOrder = {
  id: number;
  display_no: number | null;
  order_no: number;
  customer_email: string | null;
};

/**
 * Выдача заказа в Instagram/WhatsApp со ссылкой на страницу заказа и с
 * запасным путём, когда окно 24 часа закрыто (errors.ts: window_closed):
 * WhatsApp — одобренным шаблоном продавца `whatsapp_bot_notify_template`
 * со ссылкой на страницу заказа (как очередь, outbox.server); Instagram —
 * шаблонов нет, копия файлов уходит письмом, если у заказа есть почта
 * (core/orders/email после выдачи). Файлы в обоих случаях ждут на странице,
 * поэтому заказ выдан. Продавцу — причина и ссылка: `notes` для ответа
 * панели и уведомление в Telegram.
 */
export async function zernioDeliverySender(
  ctx: TenantContext,
  target: ZernioTarget,
  order: DeliveryOrder,
  deps: { transport?: ZernioTransport; start?: typeof startWhatsAppConversation } = {},
): Promise<{ send: MaterialSender; notes: string[]; pageUrl: string | null }> {
  const { orderPageUrl } = await import("@/core/storefront/web-order");
  const pageUrl = await orderPageUrl(ctx, order.id);
  const notes: string[] = [];
  const no = order.display_no ?? order.order_no;
  const onWindowClosed = async () => {
    const channel = target.platform === "whatsapp" ? "WhatsApp" : "Instagram";
    let how: string;
    if (target.platform === "whatsapp") {
      const { getSetting } = await import("@/core/settings/settings");
      const { parseNotifyTemplate } = await import("./outbox.server");
      const tpl = parseNotifyTemplate(await getSetting(ctx, "whatsapp_bot_notify_template"));
      if (!tpl)
        how =
          "Одобренный шаблон не задан (Настройки → «Автоответчик · WhatsApp» → «Шаблон для сообщений вне 24-часового окна»), поэтому покупателю ничего не ушло.";
      else if (!target.phone) how = "Номера покупателя нет, поэтому шаблон отправить некуда.";
      else {
        const r = await (deps.start ?? startWhatsAppConversation)({
          accountId: target.accountId,
          phone: target.phone,
          templateName: tpl.name,
          templateLanguage: tpl.language,
          // Параметр шаблона Meta — одна строка, без переносов.
          templateParams: [`Заказ №${no}: файлы на странице ${pageUrl}`],
          idempotencyScope: `deliver-link:${order.id}`,
        });
        how = r.ok
          ? `Ссылка на страницу заказа ушла шаблоном «${tpl.name}».`
          : `Шаблон «${tpl.name}» не отправился: ${describeSendError("whatsapp", r.error, r.failure)}`;
      }
    } else {
      const email = order.customer_email?.trim();
      const { isMailConfigured } = await import("@/core/mail/mail.server");
      how = !email
        ? "Почты покупателя нет, написать ему можно, только когда он сам напишет."
        : isMailConfigured()
          ? `Копия файлов уйдёт письмом на ${email}.`
          : "Письмо не уйдёт: почта платформы не настроена.";
    }
    notes.push(
      `${channel}: прошло больше 24 часов с последнего сообщения покупателя, файлы в переписку не ушли. ${how} Файлы ждут на странице заказа — отправьте покупателю ссылку на неё.`,
    );
    const { notifyAdminsHtml } = await import("@/channels/telegram/notify");
    const { escapeHtml } = await import("@/channels/telegram/copy");
    await notifyAdminsHtml(
      ctx,
      `⚠️ Заказ #${no}: ${escapeHtml(notes.at(-1)!)}\n\nСсылка на заказ:\n${escapeHtml(pageUrl ?? "")}`,
      { orderId: order.id, kind: "delivery_failure" },
    ).catch(() => 0);
  };
  const send = zernioMaterialSender(
    deps.transport ?? liveTransport,
    target.conversationId,
    target.accountId,
    target.platform,
    { pageUrl, onWindowClosed },
  );
  return { send, notes, pageUrl };
}
