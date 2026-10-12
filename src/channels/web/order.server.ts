import type { TenantContext } from "@/core/tenant/resolve.server";
import { getCustomer } from "@/core/customers/customers";
import {
  PROOF_SWAPPED_NOTE,
  attachPaymentProof,
  deliverOrder,
  getOrder,
  markProofVerified,
  type AttachProofResult,
  type MaterialSender,
  type OrderWithItems,
} from "@/core/orders/orders";
import { notifyReferralReward } from "@/channels/telegram/referral-notify";
import { deliverWebOrder } from "@/core/storefront/web-order";
import { adminTelegramApi, notifyDeliveryFailure } from "@/channels/telegram/notify";

/**
 * Канал «витрина сайта»: то, что в боте делают обработчики сообщений, здесь
 * делает страница заказа. Ответ покупателю — не сообщение, а исход, который
 * страница показывает; продавцу — то же уведомление в Telegram, что из бота.
 */
type NotifyOpts = Parameters<
  typeof import("@/channels/telegram/admin-notify").notifyAdminNewOrder
>[4];

async function notifySeller(ctx: TenantContext, order: OrderWithItems, opts: NotifyOpts = {}) {
  const api = adminTelegramApi(ctx);
  if (!api) return;
  const { notifyAdminNewOrder } = await import("@/channels/telegram/admin-notify");
  await notifyAdminNewOrder(ctx, api, order, null, opts).catch((e) =>
    console.warn(`[web] уведомление по заказу #${order.id}: ${String(e)}`),
  );
}

/**
 * Выдача счёта ссылкой из Instagram/WhatsApp: материалы — на странице заказа,
 * как у заказа с сайта, а в диалог — копия, если получится. Закрытое окно
 * 24 часа или сбой Zernio не делают оплаченный заказ «не выдан»: деньги
 * списаны, файлы ждут покупателя по его ссылке.
 *
 * Сбой копии не глотается молча (заказ #82 Копилки, 10.10: Zernio не ответил,
 * покупательница получила «выдан» без файлов, продавец ничего не узнал):
 * продавцу — предупреждение со ссылкой, а `copyFailedPage()` отдаёт ссылку на
 * страницу заказа для сообщения «выдан». Само сообщение с файлами не
 * повторяем — при тайм-ауте оно могло дойти.
 */
export async function invoiceLinkSender(
  ctx: TenantContext,
  order: {
    id: number;
    display_no: number | null;
    order_no: number;
    customer_email: string | null;
    user_key: string | null;
    telegram_id: number;
    platform: string;
  },
): Promise<{ send: MaterialSender; copyFailedPage: () => string | null }> {
  const { zernioDeliverySender, zernioTargetForOrder } =
    await import("@/channels/zernio/outbound.server");
  const target = await zernioTargetForOrder(ctx, order).catch(() => null);
  const copy = target ? await zernioDeliverySender(ctx, target, order).catch(() => null) : null;
  let failed = false;
  const send: MaterialSender = async (item, materials) => {
    if (!copy) return "sent";
    const r = await copy.send(item, materials).catch((e) => {
      console.warn(`[web] копия материалов в диалог: ${String(e)}`);
      return "failed" as const;
    });
    if (r === "failed" && !failed) {
      failed = true;
      await warnSellerCopyFailed(ctx, order, target!.platform, copy.pageUrl);
    }
    return "sent";
  };
  return { send, copyFailedPage: () => (failed ? (copy?.pageUrl ?? null) : null) };
}

async function warnSellerCopyFailed(
  ctx: TenantContext,
  order: { id: number; display_no: number | null; order_no: number },
  platform: string,
  pageUrl: string | null,
) {
  const no = order.display_no ?? order.order_no;
  const channel = platform === "whatsapp" ? "WhatsApp" : "Instagram";
  const { notifyAdminsHtml } = await import("@/channels/telegram/notify");
  const { escapeHtml } = await import("@/channels/telegram/copy");
  await notifyAdminsHtml(
    ctx,
    `⚠️ Заказ #${no} оплачен и выдан, но сообщение с файлами в ${channel} не подтвердилось: покупатель мог их не получить. ` +
      `В сообщение «выдан» добавлена ссылка на страницу заказа с файлами; если покупатель напишет, что файлов нет, отправьте её ещё раз:\n${escapeHtml(pageUrl ?? "")}`,
    { orderId: order.id, kind: "delivery_failure" },
  ).catch(() => 0);
}

/** Выдать и сообщить продавцу о сбое выдачи; true — всё выдано. */
async function deliverAndReport(ctx: TenantContext, order: OrderWithItems): Promise<boolean> {
  const r =
    order.platform === "web"
      ? await deliverWebOrder(ctx, order.id)
      : await deliverOrder(ctx, order.id, (await invoiceLinkSender(ctx, order)).send, {
          lang: ctx.tenant.settings.default_locale ?? "ru",
          allWhenAmbiguous: true,
        });
  if (r.failed > 0) await notifyDeliveryFailure(ctx, order, r);
  await notifyReferralReward(ctx, r.referral);
  return r.failed === 0;
}

/**
 * Заказ создан — как в боте после оформления, с одной разницей: физический
 * заказ с сайта, за который сейчас платить нечего (оплата при получении или
 * скидки на всю сумму), не идёт сразу в работу, а ждёт подтверждения
 * продавца — контакты с сайта никто не проверял. Цифровой, покрытый
 * скидками, выдаётся сразу. В остальных случаях продавец узнает о заказе
 * вместе с чеком или оплатой картой.
 */
export async function afterWebOrderPlaced(
  ctx: TenantContext,
  order: OrderWithItems,
  zeroTotal: boolean,
  amountDue = zeroTotal ? 0 : Number(order.total),
): Promise<void> {
  const physical = order.fulfillment_kind === "physical";
  if (physical && (zeroTotal || amountDue <= 0)) {
    await ctx.db
      .from("orders")
      .update({ status: "awaiting_confirmation" })
      .eq("id", order.id)
      .eq("status", "awaiting_payment");
    await notifySeller(ctx, (await getOrder(ctx, order.id)) ?? order);
    return;
  }
  if (!zeroTotal) return;
  const delivered = await deliverAndReport(ctx, order);
  await notifySeller(ctx, (await getOrder(ctx, order.id)) ?? order, { autoDelivered: delivered });
}

export type WebProofOutcome =
  | { ok: false; reason: Extract<AttachProofResult, { ok: false }>["reason"] }
  /** Автопроверка: это не чек или платёж не прошёл — можно загрузить другой файл. */
  | { ok: true; result: "retry"; paymentFailed: boolean }
  /** Чек у продавца на проверке. */
  | { ok: true; result: "review" }
  /** Чек совпал, материалы на странице. */
  | { ok: true; result: "delivered" }
  /** Чек на остаток по задатку у продавца на проверке. */
  | { ok: true; result: "balance" };

/** Чек с сайта: тот же путь, что в Instagram/WhatsApp, без переписки. */
export async function receiveWebProof(
  ctx: TenantContext,
  orderId: number,
  file: { bytes: Uint8Array; mime: string },
): Promise<WebProofOutcome> {
  const mime = file.mime.split(";")[0]!.trim().toLowerCase();
  const ext =
    mime === "application/pdf"
      ? "pdf"
      : mime === "image/png"
        ? "png"
        : mime.startsWith("image/")
          ? "jpg"
          : "bin";
  const balance = await receiveBalanceProof(ctx, orderId, { bytes: file.bytes, mime });
  if (balance) return balance;
  const res = await attachPaymentProof(ctx, orderId, { bytes: file.bytes, mime, ext });
  if (!res.ok) return { ok: false, reason: res.reason };

  const { receiptOcrAutoEnabled } = await import("@/core/receipts/verify.server");
  const customer = res.order.user_key ? await getCustomer(ctx, res.order.user_key) : null;
  if (customer && res.order.fulfillment_kind !== "physical" && (await receiptOcrAutoEnabled(ctx))) {
    const { verifyCustomerReceipt, receiptAutoDeliver, sellerReceiptNote } =
      await import("@/core/receipts/verify.server");
    const { isRetryReason } = await import("@/core/receipts/pure");
    const { result: v } = await verifyCustomerReceipt(ctx, customer, {
      bytes: file.bytes,
      mime,
      expectedAmount: Number(res.order.total),
      currency: res.order.currency,
      orderId,
      recipientCountry: res.order.country_code,
      orderCreatedAt: res.order.created_at,
    });
    if (!v.ok && isRetryReason(v.reason)) {
      await ctx.db
        .from("orders")
        .update({ status: "awaiting_payment", admin_note: `OCR: ${v.detail}`.slice(0, 500) })
        .eq("id", orderId)
        .eq("status", "awaiting_confirmation");
      return { ok: true, result: "retry", paymentFailed: v.reason === "payment_failed" };
    }
    // Выдача кнопкой продавца (по умолчанию) — продавцу итог: совпал, подозрительный, повтор.
    if (!v.ok || !(await receiptAutoDeliver(ctx))) {
      const reviewReason = sellerReceiptNote(v);
      await ctx.db
        .from("orders")
        .update({ admin_note: `OCR: ${reviewReason}`.slice(0, 500) })
        .eq("id", orderId);
      await notifySeller(ctx, res.order, { reviewReason });
      return { ok: true, result: "review" };
    }
    const verified = await markProofVerified(
      ctx,
      orderId,
      res.hash,
      `OCR ok: сумма ${v.matchedAmount}${v.matchedCurrency ? ` ${v.matchedCurrency} (по курсу)` : ""}`,
      { amount: v.matchedAmount, currency: v.matchedCurrency },
    );
    if (!verified) {
      await ctx.db
        .from("orders")
        .update({ admin_note: PROOF_SWAPPED_NOTE })
        .eq("id", orderId)
        .eq("status", "awaiting_confirmation");
      await notifySeller(ctx, res.order, { reviewReason: PROOF_SWAPPED_NOTE });
      return { ok: true, result: "review" };
    }
    const delivered = await deliverAndReport(ctx, res.order);
    await notifySeller(ctx, (await getOrder(ctx, orderId)) ?? res.order, {
      autoDelivered: delivered,
    });
    return delivered ? { ok: true, result: "delivered" } : { ok: true, result: "review" };
  }
  await notifySeller(ctx, res.order);
  return { ok: true, result: "review" };
}

/**
 * Чек на остаток по задатку (core/orders/balance): заказ уже в работе, чек
 * задатка на месте — этот ложится событием заказа, продавец проверяет его и
 * вносит оплату в карточке заказа. null — у заказа нет остатка к доплате.
 */
async function receiveBalanceProof(
  ctx: TenantContext,
  orderId: number,
  file: { bytes: Uint8Array; mime: string },
): Promise<WebProofOutcome | null> {
  const order = await getOrder(ctx, orderId);
  if (!order) return null;
  const { attachBalanceProof } = await import("@/core/orders/balance");
  const r = await attachBalanceProof(ctx, order, file);
  if (!r) return null;
  if (!r.ok) return { ok: false, reason: r.reason };
  const { notifyBalanceProof } = await import("@/channels/telegram/notify");
  await notifyBalanceProof(ctx, order, r.due);
  return { ok: true, result: "balance" };
}
