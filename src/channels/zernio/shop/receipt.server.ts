import { orderChannel } from "@/core/orders/pure";
import { formatMoney } from "@/core/money/money";
import {
  attachPaymentProof,
  attachTextProof,
  markProofVerified,
  PROOF_SWAPPED_NOTE,
  deliverOrder,
  displayNo,
  getOrder,
  listCustomerOrders,
  type OrderWithItems,
} from "@/core/orders/orders";
import { notifyReferralReward } from "@/channels/telegram/referral-notify";
import { customerTierStatus } from "@/core/loyalty/tiers";
import { getSettingStrict } from "@/core/settings/settings";
import {
  LOYALTY_MAX_REDEEM_KEY,
  loyaltyBalance,
  loyaltyEarnPercent,
  parseMaxRedeemPercent,
  shopCurrency,
} from "@/core/discounts/discounts";
import { adminTelegramApi, notifyDeliveryFailure } from "@/channels/telegram/notify";
import { downloadAttachment, refreshAttachmentUrl, type DmButton } from "../api.server";
import { zernioMaterialSender } from "../deliver";
import { plain } from "../shop-flow";
import { BTN, type Shop, reply, setMode } from "./context.server";
import { askOrderEmailIfMissing } from "./checkout.server";
import { EVENING_COPY } from "./evening-copy";

// ── чек и выдача ──────────────────────────────────────────────────────

export async function receiveProof(
  s: Shop,
  url: string,
  orderId: number,
  again: { platformMessageId: string; index: number } | null,
) {
  const download = s.transport.download ?? downloadAttachment;
  let file = await download(url, s.accountId);
  // Ссылка CDN Instagram живёт недолго (повторная обработка события, медленный
  // вебхук): перечитываем вложение у Zernio по id сообщения и только потом
  // просим покупателя прислать чек заново.
  if (!file && again) {
    const fresh = await (s.transport.refresh ?? refreshAttachmentUrl)(
      s.conversationId,
      again.platformMessageId,
      again.index,
      s.accountId,
    );
    if (fresh) file = await download(fresh, s.accountId);
  }
  if (!file) {
    await reply(s, s.m.proofFailed, { force: true });
    return;
  }
  const mime = file.mime.split(";")[0]!.trim().toLowerCase();
  const ext =
    mime === "application/pdf"
      ? "pdf"
      : mime === "image/png"
        ? "png"
        : mime.startsWith("image/")
          ? "jpg"
          : "bin";
  const res = await attachPaymentProof(s.ctx, orderId, { bytes: file.bytes, mime, ext });
  if (!res.ok) {
    await reply(s, proofErrorText(s, res.reason), { force: true });
    return;
  }
  const no = displayNo(res.order);
  const api = adminTelegramApi(s.ctx);
  const { notifyAdminNewOrder } = await import("@/channels/telegram/admin-notify");
  const notifyAdmin = async (
    o: OrderWithItems,
    opts: Parameters<typeof notifyAdminNewOrder>[4] = {},
  ) => {
    // Ссылка CDN Instagram из события протухает — продавцу карточка заказа в
    // панели: чек там лежит в нашем хранилище и открывается свежей ссылкой.
    if (api)
      await notifyAdminNewOrder(s.ctx, api, o, null, {
        ...opts,
        proofUrl: `${s.ctx.appUrl}/admin/orders/${o.id}`,
      });
  };

  // Итог автопроверки для продавца, когда заказ сам не выдаётся (см. ниже).
  let reviewReason: string | undefined;
  const { receiptOcrAutoEnabled } = await import("@/core/receipts/verify.server");
  if (res.order.fulfillment_kind !== "physical" && (await receiptOcrAutoEnabled(s.ctx))) {
    const { verifyCustomerReceipt, receiptAutoDeliver, sellerReceiptNote } =
      await import("@/core/receipts/verify.server");
    const { isRetryReason } = await import("@/core/receipts/pure");
    const checked = await verifyCustomerReceipt(s.ctx, s.customer, {
      bytes: file.bytes,
      mime,
      expectedAmount: Number(res.order.total),
      currency: res.order.currency,
      orderId,
      recipientCountry: res.order.country_code,
      orderCreatedAt: res.order.created_at,
    });
    s.customer = checked.customer;
    const v = checked.result;
    if (!v.ok && isRetryReason(v.reason)) {
      await s.ctx.db
        .from("orders")
        .update({ status: "awaiting_payment", admin_note: `OCR: ${v.detail}`.slice(0, 500) })
        .eq("id", orderId)
        .eq("status", "awaiting_confirmation");
      await reply(
        s,
        v.reason === "payment_failed"
          ? s.m.receiptPaymentFailed(String(no))
          : s.m.notReceiptLike(String(no)),
        { force: true },
      );
      return;
    }
    if (!(await receiptAutoDeliver(s.ctx))) {
      // Выдача кнопкой продавца (по умолчанию): покупателю — обычное «чек
      // получен», продавцу — итог проверки: совпал, подозрительный, повтор.
      reviewReason = sellerReceiptNote(v);
      await s.ctx.db
        .from("orders")
        .update({ admin_note: `OCR: ${reviewReason}`.slice(0, 500) })
        .eq("id", orderId);
    } else {
      await setMode(s, { mode: "idle" });
      if (!v.ok) {
        await s.ctx.db
          .from("orders")
          .update({ admin_note: `OCR: ${v.detail}`.slice(0, 500) })
          .eq("id", orderId);
        await reply(s, s.m.receiptManualReview(String(no)), { force: true });
        if (await askOrderEmailIfMissing(s, res.order))
          await reply(s, s.m.emailAsk, { force: true });
        await notifyAdmin(res.order, { reviewReason: v.detail });
        return;
      }
      return autoDeliver(s, orderId, no, res, v, notifyAdmin);
    }
  }

  await setMode(s, { mode: "idle" });
  if (await askOrderEmailIfMissing(s, res.order)) {
    await reply(s, s.m.proofReceivedNeedEmail(no), { force: true });
    await notifyAdmin(res.order, reviewReason ? { reviewReason } : {});
    return;
  }
  const email =
    orderChannel(res.order.platform) !== "telegram" ? res.order.customer_email?.trim() : null;
  await reply(s, email ? s.m.proofReceivedEmail(no, email) : s.m.proofReceived(no), {
    force: true,
    buttons: [BTN.orders(s.m), BTN.catalog(s.m)],
  });
  await notifyAdmin(res.order, reviewReason ? { reviewReason } : {});
}

/** Чек совпал, продавец включил выдачу сразу: отметка «проверен» и выдача. */
async function autoDeliver(
  s: Shop,
  orderId: number,
  no: ReturnType<typeof displayNo>,
  res: { order: OrderWithItems; hash: string },
  v: { matchedAmount: number; matchedCurrency?: string },
  notifyAdmin: (
    o: OrderWithItems,
    opts?: { reviewReason?: string; autoDelivered?: boolean },
  ) => Promise<void>,
) {
  const verified = await markProofVerified(
    s.ctx,
    orderId,
    res.hash,
    `OCR ok: сумма ${v.matchedAmount}${v.matchedCurrency ? ` ${v.matchedCurrency} (по курсу)` : ""}`,
    { amount: v.matchedAmount, currency: v.matchedCurrency },
  );
  if (!verified) {
    await s.ctx.db
      .from("orders")
      .update({ admin_note: PROOF_SWAPPED_NOTE })
      .eq("id", orderId)
      .eq("status", "awaiting_confirmation");
    await reply(s, s.m.receiptManualReview(String(no)), { force: true });
    await notifyAdmin(res.order, { reviewReason: PROOF_SWAPPED_NOTE });
    return;
  }
  await reply(s, s.m.receiptVerified(String(no)), { force: true });
  const delivered = await deliverHere(s, orderId, no);
  const fresh = (await getOrder(s.ctx, orderId)) ?? res.order;
  if (await askOrderEmailIfMissing(s, fresh)) await reply(s, s.m.emailAsk, { force: true });
  await notifyAdmin(fresh, { autoDelivered: delivered });
}

function proofErrorText(
  s: Shop,
  reason: Extract<Awaited<ReturnType<typeof attachPaymentProof>>, { ok: false }>["reason"],
): string {
  return reason === "duplicate"
    ? s.m.proofDuplicate
    : reason === "closed" || reason === "not_found"
      ? s.m.proofOrderClosed
      : reason === "invalid_file"
        ? s.m.proofBadFile
        : reason === "file_too_large"
          ? s.m.proofTooLarge
          : s.m.proofFailed;
}

/**
 * Чек текстом (shop/evening.server): заказ — продавцу на проверку, как фото,
 * без автопроверки (она читает картинку). Продавцу — текст чека в уведомлении.
 */
export async function receiveTextProof(
  s: Shop,
  orderId: number,
  text: string,
  operationNo: string | null,
) {
  const res = await attachTextProof(s.ctx, orderId, text, operationNo);
  if (!res.ok) {
    await reply(s, proofErrorText(s, res.reason), { force: true });
    return;
  }
  const no = displayNo(res.order);
  await setMode(s, { mode: "idle" });
  await reply(s, EVENING_COPY[s.locale].textReceiptTaken(no), { force: true });
  if (await askOrderEmailIfMissing(s, res.order)) await reply(s, s.m.emailAsk, { force: true });
  const api = adminTelegramApi(s.ctx);
  if (api) {
    const { notifyAdminNewOrder } = await import("@/channels/telegram/admin-notify");
    await notifyAdminNewOrder(s.ctx, api, res.order, null, {
      proofText: text,
      proofUrl: `${s.ctx.appUrl}/admin/orders/${res.order.id}`,
    });
  }
}

/** Выдача цифрового заказа ссылками в эту же переписку. */
export async function deliverHere(s: Shop, orderId: number, no: number): Promise<boolean> {
  const { orderPageUrl } = await import("@/core/storefront/web-order");
  const r = await deliverOrder(
    s.ctx,
    orderId,
    zernioMaterialSender(s.transport, s.conversationId, s.accountId, s.platform, {
      pageUrl: await orderPageUrl(s.ctx, orderId),
      locale: s.locale,
    }),
    // Direct не умеет спросить язык после оплаты — при нескольких языках отдаём все.
    { lang: s.locale, allWhenAmbiguous: true },
  );
  if (r.failed === 0 && !r.alreadyDelivered) {
    const { deliveredMessage } = await import("@/core/delivery/note.server");
    await reply(s, await deliveredMessage(s.ctx, s.platform, s.m.orderDelivered(no)), {
      force: true,
    });
  }
  if (r.failed > 0)
    await notifyDeliveryFailure(s.ctx, { id: orderId, display_no: no, order_no: no }, r);
  if (r.pointsEarned > 0) await reply(s, s.m.pointsEarned(r.pointsEarned), { force: true });
  await notifyReferralReward(s.ctx, r.referral);
  return r.failed === 0;
}

export async function showOrders(s: Shop) {
  const orders = await listCustomerOrders(s.ctx, s.customer);
  if (orders.length === 0) {
    await reply(s, s.m.myOrdersEmpty, { force: true, buttons: [BTN.catalog(s.m)] });
    return;
  }
  let text = plain(s.m.myOrdersHeader);
  for (const o of orders.slice(0, 10)) {
    const no = displayNo(o);
    const st = s.m.status[o.status] ?? o.status;
    text += `#${no} — ${formatMoney(o.total, o.currency)} — ${plain(st)}\n`;
    for (const i of o.order_items ?? []) text += `   • ${i.name_snapshot} × ${i.quantity}\n`;
  }
  // Кнопок в Direct не больше трёх: «повторить» — для последнего закрытого заказа с товарами.
  const repeatable = orders.find(
    (o) =>
      ["delivered", "rejected", "cancelled"].includes(o.status) && (o.order_items ?? []).length,
  );
  const buttons: DmButton[] = [BTN.catalog(s.m), BTN.cart(s.m)];
  if (repeatable)
    buttons.push({
      type: "postback",
      title: `${plain(s.m.reorderBtn)} #${displayNo(repeatable)}`,
      payload: `REORDER:${repeatable.id}`,
    });
  await reply(s, text, { force: true, buttons });
}

/** «Баллы»: баланс и сколько можно списать в следующем заказе; продавцу ничего не уходит. */
export async function showPoints(s: Shop) {
  const [balance, maxRaw, currency, percent] = await Promise.all([
    loyaltyBalance(s.ctx, s.customer.telegramId),
    getSettingStrict(s.ctx, LOYALTY_MAX_REDEEM_KEY),
    shopCurrency(s.ctx),
    loyaltyEarnPercent(s.ctx),
  ]);
  // Уровень лояльности (если задан и покупатель его достиг) и «до следующего».
  const tier = await customerTierStatus(s.ctx, s.customer.telegramId, currency);
  let text =
    balance > 0
      ? s.m.pointsInfo(balance, currency, parseMaxRedeemPercent(maxRaw))
      : s.m.pointsNone(tier?.tier?.percent ?? percent);
  if (tier?.tier)
    text +=
      "\n" +
      s.m.loyaltyTierLine(
        tier.tier.name,
        tier.tier.percent,
        tier.next
          ? s.m.loyaltyTierNext(formatMoney(tier.next.remaining, currency), tier.next.tier.name)
          : null,
      );
  await reply(s, plain(text), { force: true, buttons: [BTN.catalog(s.m), BTN.cart(s.m)] });
}
