import type { TenantContext } from "@/core/tenant/resolve.server";
import type { TelegramApi } from "./api";
import { adminRecipients } from "@/core/notify/recipients";
import { displayNo, type OrderWithItems } from "@/core/orders/orders";
import { escapeHtml } from "./copy";

export type ProofRef = { fileId: string; kind: "photo" | "document" } | null;

/** Уведомление продавцу о новом заказе/чеке с кнопками принять/отклонить. */
export async function notifyAdminNewOrder(
  ctx: TenantContext,
  api: TelegramApi,
  order: OrderWithItems,
  proof: ProofRef,
  opts: {
    paidOnline?: boolean;
    autoDelivered?: boolean;
    reviewReason?: string;
    /** Чек пришёл ссылкой (Instagram/WhatsApp), а не файлом Telegram. */
    proofUrl?: string;
  } = {},
): Promise<void> {
  const { loadNotifyPrefs } = await import("@/core/notify/prefs");
  const prefs = await loadNotifyPrefs(ctx);
  const recipients = prefs.kinds.new_order.telegram ? await adminRecipients(ctx) : [];
  if (recipients.length === 0 && !(prefs.kinds.new_order.email && prefs.email)) {
    console.warn(
      `[tg:${ctx.tenant.id}] admin_chat_id не настроен — заказ #${order.id} без уведомления`,
    );
    return;
  }
  const no = displayNo(order);
  const items = order.order_items ?? [];
  const paidOnline = Boolean(opts.paidOnline);
  const summary =
    (opts.autoDelivered
      ? `✅ <b>Заказ #${no}: чек распознан, файлы выданы автоматически</b>\n\n`
      : paidOnline
        ? `💳 <b>Заказ #${no} оплачен онлайн</b>\n\n`
        : `🆕 <b>Новый заказ #${no}</b>\n\n`) +
    (opts.reviewReason ? `🔎 Автопроверка чека: ${escapeHtml(opts.reviewReason)}\n\n` : "") +
    (order.platform !== "telegram" ? `📲 Канал: ${escapeHtml(order.platform)}\n` : "") +
    (opts.proofUrl ? `🧾 Чек: ${escapeHtml(opts.proofUrl)}\n` : "") +
    `👤 ${escapeHtml(order.display_name ?? "")}${order.username ? ` (@${escapeHtml(order.username)})` : ""}\n` +
    `📞 ${escapeHtml(order.contact ?? "—")}\n` +
    `🌍 ${escapeHtml(order.country_name ?? "—")}\n` +
    `📦 Позиций: ${items.length}\n\n` +
    `💰 <b>Итого: ${order.total} ${order.currency}</b>\n\n` +
    `📋 <b>Состав заказа #${no}</b>\n\n` +
    items
      .map(
        (i) =>
          `• ${escapeHtml(i.name_snapshot)} × ${i.quantity} — ${i.price_snapshot} ${order.currency}`,
      )
      .join("\n");
  const reply_markup =
    (paidOnline || opts.autoDelivered) && order.fulfillment_kind !== "physical"
      ? undefined
      : {
          inline_keyboard: [
            [
              {
                text:
                  order.fulfillment_kind === "physical"
                    ? "✅ Принять заказ"
                    : "✅ Подтвердить и выдать",
                callback_data: `confirm:${order.id}`,
              },
              { text: "❌ Отклонить", callback_data: `reject:${order.id}` },
            ],
          ],
        };
  if (prefs.kinds.new_order.email && prefs.email) {
    const { smtpMailer, isMailConfigured } = await import("@/core/mail/mail.server");
    if (isMailConfigured()) {
      const text = summary.replace(/<[^>]+>/g, "");
      await smtpMailer({
        to: prefs.email,
        subject: text.split("\n")[0]!.slice(0, 120),
        text,
        html: summary.replace(/\n/g, "<br>"),
      }).catch(() => ({ ok: false }));
    }
  }
  for (const chatId of recipients) {
    const res = await api.call("sendMessage", {
      chat_id: chatId,
      text: summary.slice(0, 4096),
      parse_mode: "HTML",
      ...(reply_markup ? { reply_markup } : {}),
    });
    if (!res.ok)
      console.warn(`[tg:${ctx.tenant.id}] уведомление ${chatId} не доставлено: ${res.description}`);
    if (proof) {
      await api.call(proof.kind === "document" ? "sendDocument" : "sendPhoto", {
        chat_id: chatId,
        [proof.kind === "document" ? "document" : "photo"]: proof.fileId,
        caption: `🧾 Чек оплаты — заказ #${no}`,
      });
    }
  }
}
