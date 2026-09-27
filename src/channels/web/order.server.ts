import type { TenantContext } from "@/core/tenant/resolve.server";
import { getCustomer } from "@/core/customers/customers";
import {
  PROOF_SWAPPED_NOTE,
  attachPaymentProof,
  getOrder,
  markProofVerified,
  type AttachProofResult,
  type OrderWithItems,
} from "@/core/orders/orders";
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

/** Выдать и сообщить продавцу о сбое выдачи; true — всё выдано. */
async function deliverAndReport(ctx: TenantContext, order: OrderWithItems): Promise<boolean> {
  const r = await deliverWebOrder(ctx, order.id);
  if (r.failed > 0) await notifyDeliveryFailure(ctx, order, r);
  return r.failed === 0;
}

/**
 * Заказ создан. Скидки покрыли всё — выдаём сразу и сообщаем продавцу; иначе
 * продавец узнает о заказе вместе с чеком, как в боте.
 */
export async function afterWebOrderPlaced(
  ctx: TenantContext,
  order: OrderWithItems,
  zeroTotal: boolean,
): Promise<void> {
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
  | { ok: true; result: "delivered" };

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
  const res = await attachPaymentProof(ctx, orderId, { bytes: file.bytes, mime, ext });
  if (!res.ok) return { ok: false, reason: res.reason };

  const { receiptOcrAutoEnabled } = await import("@/core/receipts/verify.server");
  const customer = res.order.user_key ? await getCustomer(ctx, res.order.user_key) : null;
  if (customer && res.order.fulfillment_kind !== "physical" && (await receiptOcrAutoEnabled(ctx))) {
    const { verifyCustomerReceipt } = await import("@/core/receipts/verify.server");
    const { isRetryReason } = await import("@/core/receipts/pure");
    const { result: v } = await verifyCustomerReceipt(ctx, customer, {
      bytes: file.bytes,
      mime,
      expectedAmount: Number(res.order.total),
      currency: res.order.currency,
      orderId,
    });
    if (!v.ok && isRetryReason(v.reason)) {
      await ctx.db
        .from("orders")
        .update({ status: "awaiting_payment", admin_note: `OCR: ${v.detail}`.slice(0, 500) })
        .eq("id", orderId)
        .eq("status", "awaiting_confirmation");
      return { ok: true, result: "retry", paymentFailed: v.reason === "payment_failed" };
    }
    if (!v.ok) {
      await ctx.db
        .from("orders")
        .update({ admin_note: `OCR: ${v.detail}`.slice(0, 500) })
        .eq("id", orderId);
      await notifySeller(ctx, res.order, { reviewReason: v.detail });
      return { ok: true, result: "review" };
    }
    const verified = await markProofVerified(
      ctx,
      orderId,
      res.hash,
      `OCR ok: сумма ${v.matchedAmount}${v.matchedCurrency ? ` ${v.matchedCurrency} (по курсу)` : ""}`,
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
