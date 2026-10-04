import { env } from "@/config/env";
import { adminRecipients } from "@/core/notify/recipients";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { telegramApi, type TelegramApi } from "./api";

/** Telegram-бот клиента для уведомлений продавцу; null — Telegram не подключён. */
export function adminTelegramApi(ctx: TenantContext): TelegramApi | null {
  if (!ctx.tenant.telegramTokenEnc) return null;
  return telegramApi(ctx.secrets.telegramToken(), env().TELEGRAM_API_BASE);
}

/**
 * Уведомление продавцу в Telegram (HTML) — из любого канала: заявка от
 * консультанта в Instagram тоже приходит владельцу в Telegram. Без токена
 * бота уведомить некуда — молча пропускаем, отправитель это не ошибка.
 */
export async function notifyAdminsHtml(
  ctx: TenantContext,
  html: string,
  opts: {
    orderId?: number;
    kind?: string;
    /** Кнопки под сообщением; в очередь повтора сообщение уходит без них (в тексте — ссылка). */
    replyMarkup?: { inline_keyboard: Array<Array<Record<string, string>>> };
    /** Картинки перед текстом (публичные или подписанные ссылки), лучшее усилие, до 10. */
    photos?: string[];
    /**
     * Адресат вместо всех продавцов (куратор школы): только Telegram, без
     * почты и push; матрица уведомлений продавца к нему не применяется.
     */
    recipients?: string[];
  } = {},
): Promise<number> {
  const api = adminTelegramApi(ctx);
  // Без бота Telegram — только push в админку, если он настроен (core/push).
  if (!api) return opts.recipients ? 0 : pushOnly(ctx, html, opts);
  // Матрица «событие → канал», тихие часы, почта (core/notify/prefs). Дайджест
  // сам себя не откладывает и не фильтрует.
  const isDigest = opts.kind === "digest";
  const { decideDelivery, loadNotifyPrefs, notifyKindOf } = await import("@/core/notify/prefs");
  const prefs = await loadNotifyPrefs(ctx);
  const kind = notifyKindOf(opts.kind);
  const { isMailConfigured, smtpMailer } = await import("@/core/mail/mail.server");
  const d = opts.recipients
    ? { telegram: true, email: false, defer: false }
    : isDigest
      ? {
          telegram: true,
          email: prefs.kinds.system.email && Boolean(prefs.email) && isMailConfigured(),
          defer: false,
        }
      : decideDelivery(prefs, kind, new Date(), ctx.timezone, isMailConfigured());
  if (d.defer) {
    const { deferToDigest } = await import("@/core/notify/digest");
    await deferToDigest(ctx, kind, html.replace(/<[^>]+>/g, ""));
    return 0;
  }
  let emailSent = false;
  if (d.email) {
    const text = html.replace(/<[^>]+>/g, "");
    const r = await smtpMailer({
      to: prefs.email,
      subject: text.split("\n")[0]!.slice(0, 120) || "FrogFlow",
      text,
      html: html.replace(/\n/g, "<br>"),
    }).catch((e) => ({ ok: false, error: e instanceof Error ? e.message : String(e) }));
    emailSent = r.ok;
    // Письмо могло дойти (тайм-аут, обрыв) — другим каналом не дублируем, только пишем в журнал.
    if (!r.ok) console.error(`[notify:${ctx.tenant.id}] письмо продавцу не ушло: ${r.error ?? ""}`);
  }
  // Push в админку как приложение (core/push) — тем же мгновенным каналом, что Telegram.
  if (d.telegram && !opts.recipients) await sendAdminPush(ctx, html, opts);
  if (!d.telegram) return emailSent ? 1 : 0;
  const { sendOrEnqueue } = await import("@/core/outbox/outbox");
  const { telegramOutboxSender, telegramOutboxResult } = await import("./outbox");
  let sent = 0;
  const photos = (opts.photos ?? []).slice(0, 10);
  for (const chatId of opts.recipients ?? (await adminRecipients(ctx))) {
    if (photos.length === 1)
      await api.call("sendPhoto", { chat_id: chatId, photo: photos[0] }).catch(() => null);
    else if (photos.length > 1)
      await api
        .call("sendMediaGroup", {
          chat_id: chatId,
          media: photos.map((url) => ({ type: "photo", media: url })),
        })
        .catch(() => null);
    const markup = opts.replyMarkup;
    // Не ушло — в очередь: крон повторит, продавец не останется без заказа.
    const ok = await sendOrEnqueue(
      ctx,
      {
        kind: opts.kind ?? "admin_notice",
        target: { channel: "telegram", chatId },
        text: html,
        orderId: opts.orderId,
        audience: "admin",
      },
      markup
        ? async (_ctx, msg) => {
            const r = await api.call("sendMessage", {
              chat_id: chatId,
              text: msg.text ?? "",
              parse_mode: "HTML",
              reply_markup: markup,
            });
            return telegramOutboxResult(r);
          }
        : telegramOutboxSender,
    );
    if (ok) sent += 1;
  }
  return sent;
}

/**
 * Автоматическая выдача не прошла (оплата без человека: OCR, Robokassa,
 * скидки в ноль) — продавец должен узнать сразу, а не когда покупатель
 * пожалуется. Заказ остаётся «на подтверждении» с пометкой в заметке.
 */
export async function notifyDeliveryFailure(
  ctx: TenantContext,
  order: { id: number; display_no: number | null; order_no: number },
  r: { sent: number; failed: number },
): Promise<number> {
  const no = order.display_no ?? order.order_no;
  // Повтор выдачи — в очередь: сеть или Telegram могли просто моргнуть.
  const { enqueueOutbox } = await import("@/core/outbox/outbox");
  await enqueueOutbox(
    ctx,
    {
      kind: "deliver_order",
      target: { channel: "order" },
      orderId: order.id,
      audience: "customer",
    },
    `не выдано ${r.failed} из ${r.sent + r.failed}`,
  );
  return notifyAdminsHtml(
    ctx,
    `⚠️ Заказ #${no}: не выдано ${r.failed} из ${r.sent + r.failed} поз. ` +
      `Повторим сами через несколько минут; если не поможет — проверьте файлы товара и нажмите «Подтвердить и выдать» в карточке заказа.`,
    { orderId: order.id, kind: "delivery_failure" },
  );
}

/** Покупатель прислал чек на остаток по задатку — продавцу проверить и внести оплату. */
export async function notifyBalanceProof(
  ctx: TenantContext,
  order: { id: number; currency: string; display_no?: number | null; order_no: number },
  due: number,
): Promise<void> {
  const { formatMoney } = await import("@/core/money/money");
  const { escapeHtml } = await import("./copy");
  await notifyAdminsHtml(
    ctx,
    `🧾 Покупатель прислал чек на остаток ${escapeHtml(formatMoney(due, order.currency))} по заказу #${order.display_no ?? order.order_no}. Проверьте чек в карточке заказа и нажмите «Внести оплату».`,
    { orderId: order.id, kind: "proof" },
  ).catch((e) => console.error(`[notify:${ctx.tenant.id}] уведомление о чеке на остаток`, e));
}

async function sendAdminPush(
  ctx: TenantContext,
  html: string,
  opts: { orderId?: number },
): Promise<number> {
  const { pushAdmins, pushFromHtml, vapidFromEnv } = await import("@/core/push/admin-push");
  if (!vapidFromEnv()) return 0;
  return pushAdmins(ctx, {
    ...pushFromHtml(html),
    url: opts.orderId ? `/admin/orders/${opts.orderId}` : "/admin",
    tag: opts.orderId ? `order-${opts.orderId}` : undefined,
  }).catch(() => 0);
}

/** Магазин без бота Telegram: push по той же матрице и тихим часам, без дайджеста. */
async function pushOnly(
  ctx: TenantContext,
  html: string,
  opts: { orderId?: number; kind?: string },
): Promise<number> {
  const { vapidFromEnv } = await import("@/core/push/admin-push");
  if (!vapidFromEnv() || opts.kind === "digest") return 0;
  const { decideDelivery, loadNotifyPrefs, notifyKindOf } = await import("@/core/notify/prefs");
  const d = decideDelivery(
    await loadNotifyPrefs(ctx),
    notifyKindOf(opts.kind),
    new Date(),
    ctx.timezone,
  );
  return d.telegram ? sendAdminPush(ctx, html, opts) : 0;
}
