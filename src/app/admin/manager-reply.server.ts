import type { TenantContext } from "@/core/tenant/resolve.server";
import type { ChatAttachment } from "./chat-attachment.server";
import { UserError } from "@/core/i18n/user-error";
import { api } from "./customer-notify.server";

/** Ответ менеджера покупателю и пауза бота. */

/** Ответ менеджера из панели: тем же sendMessage, что и у бота, плюс запись в лог чата. */
/** Ответ менеджера из панели — в канал покупателя: Telegram или Instagram/WhatsApp через Zernio. */
export async function replyAsManager(
  ctx: TenantContext,
  telegramId: number,
  text: string,
  attachment?: ChatAttachment,
  /** Id черновика со страницы «Чат»: повтор отправки после ошибки не удвоит сообщение. */
  draftId?: string,
  /** Кнопки под сообщением — только в Telegram (Direct/WhatsApp их здесь не рисуют). */
  options: { replyMarkup?: { inline_keyboard: { text: string; callback_data: string }[][] } } = {},
): Promise<void> {
  const { getCustomerByTelegramId } = await import("@/core/customers/customers");
  const customer = await getCustomerByTelegramId(ctx, telegramId);
  const att = await import("./chat-attachment.server");
  const checked = attachment ? await att.checkChatAttachment(ctx, attachment) : null;
  // Как orderChannel: в Zernio только Instagram и WhatsApp, незнакомое — Telegram.
  if (customer && (customer.platform === "instagram" || customer.platform === "whatsapp")) {
    if (!customer.zernioConversationId || !customer.zernioAccountId)
      throw new UserError(
        "err.admin.noZernioDialog",
        "У покупателя нет диалога в Zernio — ответить некуда",
      );
    const { sendInboxMessage } = await import("@/channels/zernio/api.server");
    const { isAttachmentRejected } = await import("@/channels/zernio/errors");
    const { text: message, ...media } = checked
      ? await att.zernioAttachmentOptions(ctx, customer.platform, text, checked)
      : { text };
    const conversationId = customer.zernioConversationId;
    const accountId = customer.zernioAccountId;
    const platform = customer.platform;
    const send = (body: string, extra: typeof media) =>
      sendInboxMessage(conversationId, accountId, body, {
        platform,
        ...extra,
        ...(draftId ? { idempotencyScope: `chat:${draftId}` } : {}),
      });
    let r = await send(message, media);
    // Канал отклонил сам файл (Instagram — PDF больше лимита, битый и т. п.):
    // та же ссылка на 7 дней уходит текстом, как у форматов, которые канал не берёт.
    if (
      !r.ok &&
      isAttachmentRejected(r.failure) &&
      media.attachmentType === "file" &&
      media.attachmentUrl
    )
      r = await send(
        att.withFileLink(text, media.attachmentName ?? "file", media.attachmentUrl),
        {},
      );
    // Окно 24 часа закрыто (errors.ts): WhatsApp — одобренным шаблоном,
    // Instagram — писать первым нельзя, продавцу — ссылка на страницу заказа.
    let viaTemplate = false;
    const { classifyZernioFailure } = await import("@/channels/zernio/errors");
    if (!r.ok && classifyZernioFailure(r.failure) === "window_closed") {
      const plainText =
        media.attachmentUrl && media.attachmentType === "file"
          ? att.withFileLink(text, media.attachmentName ?? "file", media.attachmentUrl)
          : media.attachmentUrl
            ? `${text}\n${media.attachmentUrl}`.trim()
            : message;
      await replyOutsideWindow(ctx, customer, plainText, draftId);
      viaTemplate = true;
    }
    // Отказ Zernio уже объяснён словами продавца (describeSendError) — показываем его.
    if (!r.ok && !viaTemplate)
      throw r.error
        ? new UserError("err.admin.channelRefused", "Сообщение не ушло: {reason}", {
            reason: r.error,
          })
        : new UserError("err.admin.sendFailed", "Не удалось отправить сообщение");
  } else if (checked) {
    await att.sendTelegramAttachment(ctx, telegramId, text, checked);
  } else {
    const r = await api(ctx).call("sendMessage", {
      chat_id: telegramId,
      text,
      ...(options.replyMarkup ? { reply_markup: options.replyMarkup } : {}),
    });
    if (!r.ok) throw att.telegramRefusal(r.description);
  }
  const { recordMessage } = await import("@/core/chat/chat");
  await recordMessage(ctx, {
    telegramId,
    direction: "out",
    sender: "manager",
    text: attachment ? att.attachmentLogText(attachment, text) : text,
  });
}

/**
 * Ответ из «Чата» после 24 часов тишины покупателя. WhatsApp пускает только
 * одобренный шаблон: текст продавца уходит его параметром (одной строкой,
 * ограничения Meta — channels/zernio/outbox templateParam). Шаблона нет —
 * объясняем, где его задать. Instagram шаблонов не знает: написать можно,
 * только когда покупатель напишет сам; даём ссылку на страницу его заказа,
 * чтобы продавец отправил её другим путём.
 */
async function replyOutsideWindow(
  ctx: TenantContext,
  customer: import("@/core/customers/customers").Customer,
  text: string,
  draftId?: string,
): Promise<void> {
  if (customer.platform === "whatsapp") {
    const { getSetting } = await import("@/core/settings/settings");
    const { parseNotifyTemplate, templateParam } = await import("@/channels/zernio/outbox.server");
    const tpl = parseNotifyTemplate(await getSetting(ctx, "whatsapp_bot_notify_template"));
    if (!tpl) throw new UserError("err.admin.waWindowNoTemplate", WA_TEMPLATE_MISSING);
    if (!customer.contactPhone)
      throw new UserError(
        "err.admin.waNoPhone",
        "Прошло больше 24 часов с последнего сообщения покупателя, а его номера нет — шаблон отправить некуда.",
      );
    const { describeSendError, startWhatsAppConversation } =
      await import("@/channels/zernio/api.server");
    const r = await startWhatsAppConversation({
      accountId: customer.zernioAccountId!,
      phone: customer.contactPhone,
      templateName: tpl.name,
      templateLanguage: tpl.language,
      templateParams: [templateParam(text)],
      ...(draftId ? { idempotencyScope: `chat-template:${draftId}` } : {}),
    });
    if (!r.ok)
      throw new UserError("err.admin.channelRefused", "Сообщение не ушло: {reason}", {
        reason: describeSendError("whatsapp", r.error, r.failure),
      });
    return;
  }
  const { listCustomerOrders } = await import("@/core/orders/orders");
  const { orderPageUrl } = await import("@/core/storefront/web-order");
  const [last] = await listCustomerOrders(ctx, customer, 1);
  const url = last ? await orderPageUrl(ctx, last.id) : null;
  throw url
    ? new UserError("err.admin.igWindowLink", IG_WINDOW_CLOSED + " Ссылка на его заказ: {url}", {
        url,
      })
    : new UserError("err.admin.igWindowClosed", IG_WINDOW_CLOSED);
}

const WA_TEMPLATE_MISSING =
  "Прошло больше 24 часов с последнего сообщения покупателя — WhatsApp разрешает писать только одобренным шаблоном. Задайте его: Настройки → «Автоответчик · WhatsApp» → «Шаблон для сообщений вне 24-часового окна».";

const IG_WINDOW_CLOSED =
  "Прошло больше 24 часов с последнего сообщения покупателя — Instagram не даёт написать ему первым. Ответ уйдёт, когда он напишет сам.";

/**
 * Продавец ответил из «Чата» — консультант молчит в этом диалоге столько,
 * сколько выбрано в его настройках. Раньше ответ из панели паузу не ставил,
 * и на следующее сообщение покупателя бот отвечал поверх продавца. Задачи
 * консультанта по этому покупателю закрываются: на них ответили.
 */
export async function pauseBotAfterManagerReply(
  ctx: TenantContext,
  telegramId: number,
): Promise<void> {
  const { getCustomerByTelegramId } = await import("@/core/customers/customers");
  const customer = await getCustomerByTelegramId(ctx, telegramId);
  if (!customer) return;
  const { pauseConsultant } = await import("@/core/consultant/engine.server");
  await pauseConsultant(ctx, customer);
  // Задачи консультанта по этому покупателю сделаны: менеджер ответил (core/consultant/tasks).
  const { closeTaskAfterReply } = await import("@/core/consultant/tasks");
  await closeTaskAfterReply(ctx, customer.userKey, new Date(), { via: "panel" });
}
