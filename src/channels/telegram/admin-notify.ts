import type { TenantContext } from "@/core/tenant/resolve.server";
import { orderChannel } from "@/core/orders/pure";
import type { TelegramApi } from "./api";
import { adminRecipients } from "@/core/notify/recipients";
import { displayNo, type OrderWithItems } from "@/core/orders/orders";
import { escapeHtml } from "./copy";
import { isoToDisplay } from "@/core/fulfillment/pure";
import { fulfillmentSlots, slotOf } from "@/core/fulfillment/slots";
import { collectTgMessageIds, type AdminNotifyTgRef } from "@/core/notify/order-pack";
import { rememberOrderNotify } from "./order-notify";
import { writeBuyerButton } from "./order-notify-keys";
import { sellerLocale } from "@/core/catalog/low-stock";
import { rejectedForSure } from "./api";
import { orderPhotoUrls, proofCaption, storedProof } from "./order-notify-media";

/** Как и когда получить физический заказ — продавцу в уведомлении. */
export function fulfillmentLine(order: OrderWithItems, slots: readonly string[] = []): string {
  if (order.fulfillment_kind !== "physical" || !order.fulfillment_type) return "";
  const slot = slotOf(order.fulfillment_at, slots);
  const date = order.fulfillment_at
    ? `${isoToDisplay(String(order.fulfillment_at).slice(0, 10))}${slot ? `, ${slot}` : ""}`
    : "—";
  const how = order.fulfillment_type === "delivery" ? "🚚 Доставка" : "🏪 Самовывоз";
  const where = [order.delivery_zone_name, order.fulfillment_address].filter(Boolean).join(", ");
  return (
    `${how}: ${date}\n` +
    (where ? `📍 ${escapeHtml(where)}\n` : "") +
    (order.fulfillment_note ? `💬 ${escapeHtml(order.fulfillment_note)}\n` : "")
  );
}

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
    /** Чек пришёл текстом (Kaspi не даёт скриншот): текст покупателя. */
    proofText?: string;
  } = {},
): Promise<void> {
  // Остаток после этого заказа — отдельное сообщение, независимо от матрицы «новый заказ».
  await (await import("./low-stock-notify")).notifyLowStock(ctx, order);
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
  // «Это подарок»: отдельной строкой. Не прочиталось — уведомление всё равно уходит, но с пометкой.
  const { loadOrderGift } = await import("@/core/orders/gift");
  const gift = ctx.tenant.modules.bundles
    ? await loadOrderGift(ctx, order.id).catch((e) => {
        console.error(
          `[tg:${ctx.tenant.id}] подарок заказа #${order.id} не прочитан: ${String(e)}`,
        );
        return "unreadable" as const;
      })
    : null;
  const giftText =
    gift === "unreadable"
      ? "🎁 Подарок: не удалось прочитать отметку — откройте заказ в админке\n"
      : gift
        ? `🎁 <b>Подарок${gift.recipient ? ` для ${escapeHtml(gift.recipient)}` : ""}</b>\n` +
          (gift.message ? `💌 «${escapeHtml(gift.message)}»\n` : "")
        : "";
  const summary =
    (opts.autoDelivered
      ? `✅ <b>Заказ #${no}: чек распознан, файлы выданы автоматически</b>\n\n`
      : paidOnline
        ? `💳 <b>Заказ #${no} оплачен онлайн</b>\n\n`
        : `🆕 <b>Новый заказ #${no}</b>\n\n`) +
    (opts.reviewReason ? `🔎 Автопроверка чека: ${escapeHtml(opts.reviewReason)}\n\n` : "") +
    (order.platform === "web"
      ? `🌐 С сайта — контакты не проверены${order.customer_email ? ` (${escapeHtml(order.customer_email)})` : ""}\n`
      : orderChannel(order.platform) !== "telegram"
        ? `📲 Канал: ${escapeHtml(order.platform)}\n`
        : "") +
    fulfillmentLine(order, await fulfillmentSlots(ctx)) +
    giftText +
    (opts.proofText ? `🧾 Чек текстом: «${escapeHtml(opts.proofText.slice(0, 600))}»\n` : "") +
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
  const sellerLoc = await sellerLocale(ctx).catch(() => ctx.tenant.settings.default_locale ?? "ru");
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
            [writeBuyerButton(order.id, sellerLoc)],
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
  // Сообщения уведомления — чтобы после решения снять кнопки и убрать их из чата.
  const refs: AdminNotifyTgRef[] = [];
  const remember = (chatId: string, result: unknown, buttons: boolean) => {
    for (const id of collectTgMessageIds(result))
      refs.push({ chat_id: chatId, message_id: id, ...(buttons ? { buttons: true } : {}) });
  };
  // Фото товаров и чек из хранилища читаем один раз на всех продавцов.
  const photos = recipients.length ? await orderPhotoUrls(ctx, order) : [];
  const stored = recipients.length && !proof ? await storedProof(ctx, order) : null;
  const header = summary.split("\n")[0]!;
  const caption = `${header}\n💰 ${order.total} ${order.currency}`.slice(0, 1024);
  const locale = ctx.tenant.settings.default_locale;
  for (const chatId of recipients) {
    // Альбом — отдельным сообщением: сбой фото не должен ронять текст, а текст уходит один раз.
    if (photos.length > 0) {
      const album =
        photos.length === 1
          ? await api.call("sendPhoto", {
              chat_id: chatId,
              photo: photos[0],
              caption,
              parse_mode: "HTML",
            })
          : await api.call("sendMediaGroup", {
              chat_id: chatId,
              media: photos.map((url, i) => ({
                type: "photo",
                media: url,
                ...(i === 0 ? { caption, parse_mode: "HTML" } : {}),
              })),
            });
      if (album.ok) remember(chatId, album.result, false);
      else
        console.warn(
          `[tg:${ctx.tenant.id}] фото заказа ${chatId} не доставлены: ${album.description}`,
        );
    }
    const res = await api.call("sendMessage", {
      chat_id: chatId,
      text: summary.slice(0, 4096),
      parse_mode: "HTML",
      ...(reply_markup ? { reply_markup } : {}),
    });
    if (!res.ok)
      console.warn(`[tg:${ctx.tenant.id}] уведомление ${chatId} не доставлено: ${res.description}`);
    else remember(chatId, res.result, Boolean(reply_markup));
    // Чек — ответом на уведомление, с теми же кнопками.
    const replyTo = res.ok ? collectTgMessageIds(res.result)[0] : undefined;
    const proofExtra = {
      chat_id: chatId,
      caption: proofCaption(locale, no),
      ...(replyTo
        ? { reply_parameters: { message_id: replyTo, allow_sending_without_reply: true } }
        : {}),
      ...(reply_markup ? { reply_markup } : {}),
    };
    let p: Awaited<ReturnType<typeof api.call>> | null = null;
    if (proof) {
      p = await api.call(proof.kind === "document" ? "sendDocument" : "sendPhoto", {
        ...proofExtra,
        [proof.kind === "document" ? "document" : "photo"]: proof.fileId,
      });
    } else if (stored) {
      p = await api.call(stored.kind === "document" ? "sendDocument" : "sendPhoto", {
        ...proofExtra,
        [stored.kind]: stored.url,
      });
      // Фото не принято наверняка (формат, размер) — тем же файлом документом; обрыв не повторяем.
      if (!p.ok && stored.kind === "photo" && rejectedForSure(p))
        p = await api.call("sendDocument", { ...proofExtra, document: stored.url });
    }
    if (p?.ok) remember(chatId, p.result, Boolean(reply_markup));
    else if (p) console.warn(`[tg:${ctx.tenant.id}] чек ${chatId} не доставлен: ${p.description}`);
  }
  await rememberOrderNotify(ctx, order.id, refs).catch((e) =>
    console.warn(`[tg:${ctx.tenant.id}] сообщения уведомления #${order.id} не запомнены`, e),
  );
}
