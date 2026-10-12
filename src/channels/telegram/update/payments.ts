// Оплата: Telegram Stars, чеки покупателя и продавца, доплата остатка.
import { orderBuyerLocale } from "@/core/orders/buyer-locale";
import { imageUrl } from "@/core/catalog/catalog";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { TelegramApi } from "../api";
import type { TelegramMessage } from "../types";
import { COPY, escapeHtml } from "../copy";
import { formatMoney } from "@/core/money/money";
import { getCustomer, setState } from "@/core/customers/customers";
import {
  attachPaymentProof,
  deliverOrder,
  displayNo,
  getOrder,
  listActivePaymentMethods,
  markProofVerified,
  PROOF_SWAPPED_NOTE,
  recentAwaitingPaymentOrder,
} from "@/core/orders/orders";
import { notifyAdminNewOrder } from "../admin-notify";
import { notifyBalanceProof, notifyDeliveryFailure } from "../notify";
import {
  attachBalanceProof,
  balanceDue,
  balancePayable,
  balanceProofPending,
  claimBalanceInvId,
} from "@/core/orders/balance";
import { telegramLanguageAsker, telegramMaterialSender } from "../deliver";
import { robokassaFor, robokassaReceipt } from "@/core/payments/payment";
import { buildPaymentUrl } from "@/core/payments/robokassa";
import { type Bot, localeOf, mainMenu, send } from "./bot";
import { notifyReferral } from "./orders";

/** Оплата картой подтверждена шлюзом: выдать цифровой заказ, сообщить покупателю и продавцу. */
/** Сумма заказа к оплате сейчас — в звёздах; null — Stars недоступны. */
export async function starsDue(
  ctx: TenantContext,
  order: import("@/core/orders/orders").OrderWithItems,
): Promise<number | null> {
  const { amountDueNow } = await import("@/core/fulfillment/fulfillment");
  const due = await amountDueNow(ctx, {
    total: Number(order.total),
    fulfillment_kind: order.fulfillment_kind,
  });
  const { starsForOrder } = await import("@/core/payments/stars");
  return starsForOrder(ctx, due, order.currency);
}

/**
 * Перед списанием звёзд Telegram спрашивает бота, можно ли: заказ наш, ещё
 * ждёт оплаты, сумма та же. Ответить нужно за 10 секунд.
 */
export async function handlePreCheckout(
  ctx: TenantContext,
  api: TelegramApi,
  q: import("../types").TelegramPreCheckoutQuery,
): Promise<void> {
  const { parseStarsPayload } = await import("@/core/payments/stars");
  const orderId = parseStarsPayload(q.invoice_payload);
  const order = orderId ? await getOrder(ctx, orderId) : null;
  // Ответ покупателю — на его языке, а не на языке магазина.
  // Сбой чтения профиля не должен оставить pre_checkout без ответа: orderBuyerLocale падает на язык магазина.
  const m =
    COPY[
      await orderBuyerLocale(ctx, order ?? { user_key: `tg_${q.from.id}`, telegram_id: q.from.id })
    ];
  const expected = order ? await starsDue(ctx, order) : null;
  const ok =
    Boolean(order) &&
    ctx.tenant.modules.telegram_stars &&
    q.currency === "XTR" &&
    order!.telegram_id === q.from.id &&
    order!.status === "awaiting_payment" &&
    expected === q.total_amount;
  await api.call(
    "answerPreCheckoutQuery",
    ok
      ? { pre_checkout_query_id: q.id, ok: true }
      : { pre_checkout_query_id: q.id, ok: false, error_message: m.starsPaymentStale },
  );
}

/** Звёзды списаны: фиксируем оплату тем же путём, что Robokassa, и выдаём. */
export async function handleStarsPaid(
  ctx: TenantContext,
  api: TelegramApi,
  msg: TelegramMessage,
): Promise<void> {
  const pay = msg.successful_payment!;
  if (pay.currency !== "XTR") return;
  const { parseStarsPayload } = await import("@/core/payments/stars");
  const orderId = parseStarsPayload(pay.invoice_payload);
  if (!orderId) return;
  const order = await getOrder(ctx, orderId);
  if (!order || order.telegram_id !== msg.from?.id) return;
  const { amountDueNow } = await import("@/core/fulfillment/fulfillment");
  const due = await amountDueNow(ctx, {
    total: Number(order.total),
    fulfillment_kind: order.fulfillment_kind,
  });
  const { markPaidOnline } = await import("@/core/payments/payment");
  const r = await markPaidOnline(
    ctx,
    orderId,
    due,
    `Telegram Stars (${pay.total_amount} ⭐${pay.telegram_payment_charge_id ? `, ${pay.telegram_payment_charge_id}` : ""})`,
    pay.telegram_payment_charge_id || undefined,
  );
  if (r.ok && !r.alreadyDone) await onOrderPaid(ctx, api, orderId);
  else if (r.closed) {
    // Звёзды списаны, а заказ закрыли между pre_checkout и оплатой — как у
    // Robokassa: продавцу срочно, решает он (выдать или вернуть звёзды).
    const { reportUnappliedPayment } = await import("@/app/payments/unapplied-payment.server");
    await reportUnappliedPayment(ctx, order, "payment_on_closed", {
      amount: due,
      currency: order.currency,
      provider: "Telegram Stars",
      ref: pay.telegram_payment_charge_id ?? "",
      status: r.status,
    }).catch((e) => console.error(`[stars:${ctx.tenant.id}] платёж по закрытому заказу`, e));
  }
}

export async function onOrderPaid(
  ctx: TenantContext,
  api: TelegramApi,
  orderId: number,
): Promise<void> {
  const order = await getOrder(ctx, orderId);
  if (!order) return;
  const customer = await getCustomer(ctx, order.user_key ?? `tg_${order.telegram_id}`);
  const locale = customer ? localeOf(ctx, customer) : "ru";
  const m = COPY[locale];
  const no = displayNo(order);
  await api.call("sendMessage", { chat_id: order.telegram_id, text: m.paymentReceived(no) });
  if (customer) await setState(ctx, customer, { ...customer.state, mode: "idle" });
  if (order.fulfillment_kind !== "physical") {
    const r = await deliverOrder(ctx, orderId, telegramMaterialSender(api, order.telegram_id, m), {
      lang: locale,
      ask: telegramLanguageAsker(api, order.telegram_id, m),
    });
    if (r.failed === 0 && r.pending === 0 && !r.alreadyDelivered)
      await api.call("sendMessage", { chat_id: order.telegram_id, text: m.orderDelivered(no) });
    if (r.failed > 0) await notifyDeliveryFailure(ctx, order, r);
    if (r.pointsEarned > 0)
      await api.call("sendMessage", {
        chat_id: order.telegram_id,
        text: m.pointsEarned(r.pointsEarned),
      });
    await notifyReferral(ctx, api, r.referral);
  }
  const fresh = await getOrder(ctx, orderId);
  if (fresh) await notifyAdminNewOrder(ctx, api, fresh, null, { paidOnline: true });
}

export async function receiveProof(b: Bot, msg: TelegramMessage, orderId: number) {
  const fileId = msg.document?.file_id ?? msg.photo?.[msg.photo.length - 1]?.file_id;
  if (!fileId) return;
  const kind: "photo" | "document" = msg.document ? "document" : "photo";
  const file = await downloadTelegramFile(b.api, fileId);
  if (!file) {
    await send(b, b.m.proofFailed);
    return;
  }
  const docName = (msg.document?.file_name ?? "").toLowerCase();
  const ext =
    docName.match(/\.([a-z0-9]{1,8})$/)?.[1] ??
    (msg.document?.mime_type === "application/pdf" ? "pdf" : kind === "photo" ? "jpg" : "bin");
  const res = await attachPaymentProof(b.ctx, orderId, { bytes: file.bytes, mime: file.mime, ext });
  if (!res.ok) {
    const text =
      res.reason === "duplicate"
        ? b.m.proofDuplicate
        : res.reason === "closed" || res.reason === "not_found"
          ? b.m.proofOrderClosed
          : res.reason === "invalid_file"
            ? b.m.proofBadFile
            : res.reason === "file_too_large"
              ? b.m.proofTooLarge
              : b.m.proofFailed;
    await send(b, text);
    return;
  }
  const no = displayNo(res.order);
  const proof = { fileId, kind };

  // Автопроверка чека (модуль receipt_ocr): цифровой заказ выдаётся сам,
  // сомнительный — продавцу с причиной, не-чек — просим прислать заново.
  // Итог автопроверки для продавца, когда заказ сам не выдаётся (см. ниже).
  let reviewReason: string | undefined;
  const { receiptOcrAutoEnabled } = await import("@/core/receipts/verify.server");
  if (res.order.fulfillment_kind !== "physical" && (await receiptOcrAutoEnabled(b.ctx))) {
    const { verifyCustomerReceipt, receiptAutoDeliver, sellerReceiptNote } =
      await import("@/core/receipts/verify.server");
    const { isRetryReason } = await import("@/core/receipts/pure");
    const checked = await verifyCustomerReceipt(b.ctx, b.customer, {
      bytes: file.bytes,
      mime: file.mime,
      expectedAmount: Number(res.order.total),
      currency: res.order.currency,
      orderId,
      recipientCountry: res.order.country_code,
      orderCreatedAt: res.order.created_at,
    });
    b.customer = checked.customer;
    const v = checked.result;
    if (!v.ok && isRetryReason(v.reason)) {
      await b.ctx.db
        .from("orders")
        .update({ status: "awaiting_payment", admin_note: `OCR: ${v.detail}`.slice(0, 500) })
        .eq("id", orderId)
        .eq("status", "awaiting_confirmation");
      await send(
        b,
        v.reason === "payment_failed"
          ? b.m.receiptPaymentFailed(String(no))
          : b.m.notReceiptLike(String(no)),
      );
      return;
    }
    if (!(await receiptAutoDeliver(b.ctx))) {
      // Выдача кнопкой продавца (по умолчанию): покупателю — обычное «чек
      // получен», продавцу — итог проверки: совпал, подозрительный, повтор.
      reviewReason = sellerReceiptNote(v);
      await b.ctx.db
        .from("orders")
        .update({ admin_note: `OCR: ${reviewReason}`.slice(0, 500) })
        .eq("id", orderId);
    } else {
      b.customer = await setState(b.ctx, b.customer, { ...b.customer.state, mode: "idle" });
      if (!v.ok) {
        await b.ctx.db
          .from("orders")
          .update({ admin_note: `OCR: ${v.detail}`.slice(0, 500) })
          .eq("id", orderId);
        await send(b, b.m.receiptManualReview(String(no)), { reply_markup: mainMenu(b) });
        await notifyAdminNewOrder(b.ctx, b.api, res.order, proof, { reviewReason: v.detail });
        return;
      }
      const verified = await markProofVerified(
        b.ctx,
        orderId,
        res.hash,
        `OCR ok: сумма ${v.matchedAmount}${v.matchedCurrency ? ` ${v.matchedCurrency} (по курсу)` : ""}`,
        { amount: v.matchedAmount, currency: v.matchedCurrency },
      );
      if (!verified) {
        await b.ctx.db
          .from("orders")
          .update({ admin_note: PROOF_SWAPPED_NOTE })
          .eq("id", orderId)
          .eq("status", "awaiting_confirmation");
        await send(b, b.m.receiptManualReview(String(no)), { reply_markup: mainMenu(b) });
        await notifyAdminNewOrder(b.ctx, b.api, res.order, proof, {
          reviewReason: PROOF_SWAPPED_NOTE,
        });
        return;
      }
      await send(b, b.m.receiptVerified(String(no)), { reply_markup: mainMenu(b) });
      const r = await deliverOrder(b.ctx, orderId, telegramMaterialSender(b.api, b.chatId, b.m), {
        lang: b.locale,
        ask: telegramLanguageAsker(b.api, b.chatId, b.m),
      });
      if (r.failed === 0 && r.pending === 0 && !r.alreadyDelivered)
        await send(b, b.m.orderDelivered(no));
      if (r.failed > 0) await notifyDeliveryFailure(b.ctx, res.order, r);
      if (r.pointsEarned > 0) await send(b, b.m.pointsEarned(r.pointsEarned));
      await notifyReferral(b.ctx, b.api, r.referral);
      const fresh = (await getOrder(b.ctx, orderId)) ?? res.order;
      await notifyAdminNewOrder(b.ctx, b.api, fresh, proof, { autoDelivered: r.failed === 0 });
      return;
    }
  }

  b.customer = await setState(b.ctx, b.customer, { ...b.customer.state, mode: "idle" });
  await send(b, b.m.proofReceived(no), { reply_markup: mainMenu(b) });
  if (reviewReason) await notifyAdminNewOrder(b.ctx, b.api, res.order, proof, { reviewReason });
  else await notifyAdminNewOrder(b.ctx, b.api, res.order, proof);
}

/**
 * Владелец отвечает на счёт оператора фото или файлом — тем же жестом, что
 * покупатель с чеком по заказу. Только когда у владельца есть открытый счёт
 * и нет своего заказа, ждущего чек (иначе тест собственного чекаута попал бы
 * сюда). Возвращает true, если сообщение обработано.
 */
export async function ownerInvoiceProof(
  ctx: TenantContext,
  api: TelegramApi,
  msg: TelegramMessage,
): Promise<boolean> {
  const from = msg.from;
  if (!from || Number(ctx.tenant.ownerTelegramId) !== Number(from.id)) return false;
  const { attachInvoiceProof, openInvoicesForOwner } = await import("@/core/billing/invoices");
  const open = await openInvoicesForOwner(ctx, from.id);
  if (!open.length) return false;
  const customer = await getCustomer(ctx, `tg_${from.id}`);
  if (customer && (await recentAwaitingPaymentOrder(ctx, customer))) return false;
  const fileId = msg.document?.file_id ?? msg.photo?.[msg.photo.length - 1]?.file_id;
  if (!fileId) return false;
  const file = await downloadTelegramFile(api, fileId);
  const reply = (text: string) => api.call("sendMessage", { chat_id: msg.chat.id, text });
  if (!file) {
    await reply("Не удалось скачать файл из Telegram, попробуйте отправить ещё раз.");
    return true;
  }
  const docName = (msg.document?.file_name ?? "").toLowerCase();
  const ext =
    docName.match(/\.([a-z0-9]{1,8})$/)?.[1] ??
    (file.mime === "application/pdf" ? "pdf" : msg.document ? "bin" : "jpg");
  // Несколько открытых счетов (подписка и пополнение ИИ-баланса) — чек к тому,
  // с которым он сходится; не ровно к одному — к старейшему, проверяет оператор.
  const { pickInvoiceForReceipt, verifyInvoiceProof } =
    await import("@/core/billing/invoice-check.server");
  const { invoice, ...pre } = await pickInvoiceForReceipt(ctx, open, file);
  const r = await attachInvoiceProof(ctx, invoice, { ...file, ext });
  if (!r.ok) {
    await reply(
      r.reason === "upload_failed"
        ? "Не удалось сохранить чек, попробуйте отправить ещё раз."
        : "Этот счёт уже обработан — если нужен новый, напишите оператору.",
    );
    return true;
  }
  // Автопроверка: прошла — подписка продлена сразу; нет — чек ждёт оператора.
  const { settleInvoiceProof } = await import("@/app/operator/billing.server");
  const settled = await settleInvoiceProof(
    ctx.tenant.id,
    invoice.id,
    await verifyInvoiceProof(ctx, invoice, file, pre),
  );
  if (settled.confirmed) {
    const until = settled.expiresAt
      ? ` Подписка оплачена до ${new Date(settled.expiresAt).toLocaleDateString("ru")}.`
      : "";
    await reply(`Оплата ${invoice.amount} ${invoice.currency} подтверждена, спасибо!${until}`);
    return true;
  }
  await reply(
    `Чек получен по счёту на ${invoice.amount} ${invoice.currency}${invoice.note ? ` — ${invoice.note}` : ""}. Ожидайте подтверждения оплаты.`,
  );
  return true;
}

export async function downloadTelegramFile(
  api: TelegramApi,
  fileId: string,
): Promise<{ bytes: Uint8Array; mime: string } | null> {
  const info = await api.call<{ file_path?: string }>("getFile", { file_id: fileId });
  const path = info.result?.file_path;
  if (!info.ok || !path) return null;
  const res = await fetch(api.fileUrl(path), { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) return null;
  return {
    bytes: new Uint8Array(await res.arrayBuffer()),
    mime: res.headers.get("content-type") ?? "application/octet-stream",
  };
}

/**
 * «Оплатить остаток»: сумма с сервера (core/orders/balance), реквизиты
 * страны заказа и кнопка оплаты картой, если Robokassa подключена. Дальше
 * бот ждёт чек на остаток (awaiting_balance_proof).
 */
export async function showBalancePayment(
  b: Bot,
  order: import("@/core/orders/orders").OrderWithItems,
) {
  const due = await balancePayable(b.ctx, order);
  if (!due) {
    await send(b, balanceDue(order) > 0 ? b.m.balanceProofWaiting : b.m.balanceNotDue);
    return;
  }
  const no = displayNo(order);
  const method =
    (await listActivePaymentMethods(b.ctx)).find((x) => x.country_code === order.country_code) ??
    null;
  const rk = await robokassaFor(b.ctx, order.currency);
  const url = rk.ready
    ? buildPaymentUrl(rk, {
        outSum: due,
        invId: await claimBalanceInvId(b.ctx, order.id, due),
        description: `Остаток по заказу #${no}`,
        botId: b.ctx.tenant.id,
        receipt: robokassaReceipt(rk, order, due, `Остаток по заказу #${no}`),
      })
    : null;
  b.customer = await setState(b.ctx, b.customer, {
    ...b.customer.state,
    mode: "awaiting_balance_proof",
    pending_order_id: order.id,
    pending_display_no: no,
  });
  const text =
    `${b.m.balanceTitle(no, formatMoney(due, order.currency))}\n\n` +
    `${method?.instructions ? escapeHtml(method.instructions) : b.m.balanceNoDetails}\n\n` +
    b.m.balanceHowTo(Boolean(url));
  await send(
    b,
    text,
    url ? { reply_markup: { inline_keyboard: [[{ text: b.m.payViaRobokassaBtn, url }]] } } : {},
  );
  if (method?.qr_code_path)
    await b.api.call("sendPhoto", {
      chat_id: b.chatId,
      photo: imageUrl(b.ctx, method.qr_code_path),
    });
}

/** Чек на остаток: в бакет рядом с чеком задатка, продавцу — проверить и внести оплату. */
export async function receiveBalanceProof(b: Bot, msg: TelegramMessage, orderId: number) {
  const order = await getOrder(b.ctx, orderId);
  const toIdle = async () => {
    b.customer = await setState(b.ctx, b.customer, { ...b.customer.state, mode: "idle" });
  };
  if (!order || order.telegram_id !== b.customer.telegramId) return void (await toIdle());
  if (balanceDue(order) > 0 && (await balanceProofPending(b.ctx, order.id, order.paid_amount))) {
    await toIdle();
    return void (await send(b, b.m.balanceProofWaiting, { reply_markup: mainMenu(b) }));
  }
  const fileId = msg.document?.file_id ?? msg.photo?.[msg.photo.length - 1]?.file_id;
  if (!fileId) return;
  const file = await downloadTelegramFile(b.api, fileId);
  if (!file) return void (await send(b, b.m.proofFailed));
  const r = await attachBalanceProof(b.ctx, order, { bytes: file.bytes, mime: file.mime });
  if (!r) {
    await toIdle();
    return void (await send(b, b.m.balanceNotDue, { reply_markup: mainMenu(b) }));
  }
  if (!r.ok) {
    const text =
      r.reason === "duplicate"
        ? b.m.proofDuplicate
        : r.reason === "invalid_file"
          ? b.m.proofBadFile
          : r.reason === "file_too_large"
            ? b.m.proofTooLarge
            : b.m.proofFailed;
    return void (await send(b, text));
  }
  await toIdle();
  await send(b, b.m.balanceProofReceived(displayNo(order)), { reply_markup: mainMenu(b) });
  await notifyBalanceProof(b.ctx, order, r.due);
}
