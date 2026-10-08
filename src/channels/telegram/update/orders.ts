// Мои заказы, повтор заказа, отзывы, рефералы и выдача материалов.
import { lastPaidOrder, shortLabels } from "@/core/orders/reorder";
import type { ReferralGrant } from "@/core/referrals/referrals";
import { notifyReferralReward } from "../referral-notify";
import { saveComment } from "@/core/reviews/reviews";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { TelegramApi } from "../api";
import type { InlineButton, TelegramMessage } from "../types";
import { escapeHtml } from "../copy";
import type { Locale } from "@/core/i18n/locale";
import { formatMoney } from "@/core/money/money";
import {
  canResendMaterials,
  completeLanguageDelivery,
  displayNo,
  getOrder,
  listCustomerOrders,
  reorderReport,
} from "@/core/orders/orders";
import { balanceDue, balancePayable } from "@/core/orders/balance";
import { telegramMaterialSender } from "../deliver";
import { type Bot, send } from "./bot";
import { showCart } from "./cart";
import { downloadTelegramFile } from "./payments";

/** Повторить заказ: те же товары в корзину по текущим ценам и остаткам; чего нет — названо. */
export async function reorderFrom(b: Bot, order: import("@/core/orders/orders").OrderWithItems) {
  const report = await reorderReport(b.ctx, b.customer, order);
  const missing = report.short.length ? b.m.reorderShort(shortLabels(report.short)) : "";
  if (!report.added)
    return void (await send(b, [b.m.reorderNothing, missing].filter(Boolean).join("\n")));
  await send(b, [b.m.reorderDone(report.added), missing].filter(Boolean).join("\n"));
  return showCart(b);
}

/** false — оплаченного заказа нет и разговор не ведётся с ботом: слово уходит дальше (консультанту, поиску). */
export async function reorderLast(b: Bot): Promise<boolean> {
  const order = await lastPaidOrder(b.ctx, b.customer);
  if (!order) {
    // Одиночное «повторить» без заказов — подсказка только на явную фразу про заказ.
    await send(b, b.m.reorderNoPaid);
    return true;
  }
  await reorderFrom(b, order);
  return true;
}

/** Фото к отзыву (core/reviews/photos): тип и размер проверяются по файлу. */
export async function receiveReviewPhoto(b: Bot, msg: TelegramMessage, productId: string) {
  const { REVIEW_PHOTO_MAX_BYTES, REVIEW_PHOTOS_MAX } = await import("@/core/reviews/photos");
  const photo = msg.photo?.[msg.photo.length - 1];
  const fileId = msg.document?.file_id ?? photo?.file_id;
  const declared = msg.document?.file_size ?? photo?.file_size ?? 0;
  if (!fileId || declared > REVIEW_PHOTO_MAX_BYTES) return send(b, b.m.reviewPhotoBad);
  const file = await downloadTelegramFile(b.api, fileId);
  if (!file) return send(b, b.m.reviewPhotoBad);
  const { addReviewPhoto } = await import("@/core/reviews/photos.server");
  const r = await addReviewPhoto(b.ctx, b.customer.telegramId, productId, file.bytes);
  const caption = msg.caption?.trim();
  if (caption) await saveComment(b.ctx, b.customer.telegramId, productId, caption);
  if (r.ok) return send(b, b.m.reviewPhotoAdded(r.count, REVIEW_PHOTOS_MAX));
  if (r.reason === "limit") return send(b, b.m.reviewPhotoLimit(REVIEW_PHOTOS_MAX));
  if (r.reason === "no_review") return send(b, b.m.reviewNotAllowed);
  return send(b, b.m.reviewPhotoBad);
}

export async function askRating(b: Bot, productId: string, name: string) {
  await send(b, b.m.chooseRatingPrompt(escapeHtml(name)), {
    reply_markup: {
      inline_keyboard: [
        [1, 2, 3, 4, 5].map((n) => ({
          text: "⭐".repeat(n),
          callback_data: `stars:${productId}:${n}`,
        })),
      ],
    },
  });
}

/** Награда пригласившему после выдачи — своим сообщением, на своём языке. */
export function notifyReferral(
  ctx: TenantContext,
  api: TelegramApi,
  grant: ReferralGrant | null | undefined,
) {
  return notifyReferralReward(ctx, grant, api);
}

export async function showMyOrders(b: Bot) {
  const orders = await listCustomerOrders(b.ctx, b.customer);
  if (orders.length === 0) {
    await send(b, b.m.myOrdersEmpty);
    return;
  }
  let text = b.m.myOrdersHeader;
  const buttons: InlineButton[][] = [];
  for (const o of orders) {
    const no = displayNo(o);
    const st = b.m.status[o.status] ?? o.status;
    text += `#${no} — ${formatMoney(o.total, o.currency)} — ${st}\n`;
    for (const i of o.order_items ?? [])
      text += `   • ${escapeHtml(i.name_snapshot)} × ${i.quantity}\n`;
    const row: InlineButton[] = [];
    if (canResendMaterials(o))
      row.push({ text: `${b.m.resendBtn} #${no}`, callback_data: `resend:${o.id}` });
    if (["delivered", "rejected", "cancelled"].includes(o.status) && (o.order_items ?? []).length)
      row.push({ text: `${b.m.reorderBtn} #${no}`, callback_data: `reorder:${o.id}` });
    if (o.status === "delivered" && b.ctx.tenant.modules.review_request)
      row.push({ text: b.m.rateBtn(String(no)), callback_data: `rate:${o.id}` });
    // Задаток внесён, заказ в работе — доплатить остаток отсюда же.
    if (balanceDue(o) > 0 && (await balancePayable(b.ctx, o)) > 0)
      row.push({ text: b.m.payBalanceBtn(no), callback_data: `balance:${o.id}` });
    if (row.length) buttons.push(row);
  }
  await send(
    b,
    text.slice(0, 4096),
    buttons.length ? { reply_markup: { inline_keyboard: buttons } } : {},
  );
}

/** Выдать позицию на выбранном языке; последний ответ закрывает заказ. */
export async function deliverInLanguage(b: Bot, orderId: number, itemId: string, lang: Locale) {
  const r = await completeLanguageDelivery(
    b.ctx,
    { orderId, itemId, lang, telegramId: b.customer.telegramId },
    telegramMaterialSender(b.api, b.chatId, b.m),
  );
  if (r.status !== "sent") {
    if (r.status === "already") await send(b, b.m.fileAlreadySent);
    else if (r.status === "failed") await send(b, b.m.proofFailed);
    return;
  }
  if (r.completed) {
    const order = await getOrder(b.ctx, orderId);
    if (order) await send(b, b.m.orderDelivered(displayNo(order)));
    if (r.pointsEarned > 0) await send(b, b.m.pointsEarned(r.pointsEarned));
    await notifyReferral(b.ctx, b.api, r.referral);
  }
}
