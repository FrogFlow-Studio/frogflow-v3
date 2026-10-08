// Нажатия инлайн-кнопок покупателя.
import {
  hasDeliveredPurchase,
  reviewableProductsForOrder,
  saveRating,
} from "@/core/reviews/reviews";
import { isValidRating } from "@/core/reviews/pure";
import { inboundIntercepted, tappedButtonText } from "@/core/chat/chat";
import { recordClick, splitClickMark } from "@/core/broadcasts/clicks";
import { getProduct } from "@/core/catalog/catalog";
import { isDeliveryLangChoice } from "@/core/catalog/materials";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { TelegramApi } from "../api";
import { sendChannelInvite, startHomework } from "../courses";
import type { TelegramCallbackQuery } from "../types";
import { COPY, escapeHtml } from "../copy";
import { isLocale } from "@/core/i18n/locale";
import { formatMoney } from "@/core/money/money";
import { isBlocked, setState, upsertCustomer } from "@/core/customers/customers";
import { addToCart, clearCart, removeCartItem } from "@/core/cart/cart";
import {
  deliverOrder,
  displayNo,
  getOrder,
  listActivePaymentMethods,
  reopenForResend,
} from "@/core/orders/orders";
import { telegramLanguageAsker, telegramMaterialSender } from "../deliver";
import { legacyLangItem, parseLegacyLang, parseSearchMore } from "../legacy";
import { robokassaFor, robokassaReceipt } from "@/core/payments/payment";
import { buildPaymentUrl } from "@/core/payments/robokassa";
import { freeSlotsOnDate } from "@/core/fulfillment/capacity";
import { serverFailure } from "@/lib/server-failure";
import { sellsNowOrShop } from "@/core/tenant/sells.server";
import { type Bot, DEFAULT_PAUSED, localeOf, send } from "./bot";
import { showCart } from "./cart";
import { quizAsk, sendProductCard, showCategories, showSearch } from "./catalog";
import {
  afterDate,
  answerApproval,
  askCountry,
  askFulfillmentDate,
  finishAfterNote,
  finishCheckout,
  pickZone,
  sendManualInstructions,
  startCheckout,
} from "./checkout";
import { askRating, deliverInLanguage, reorderFrom } from "./orders";
import { showBalancePayment, starsDue } from "./payments";
import { adminDecision, adminOrderButton } from "./seller";
import { applyLocale, optOutReply } from "./start";

// ── callback-кнопки ───────────────────────────────────────────────────

const NAV_NEEDS_COUNTRY = /^(cat:|prod:|checkout$|cart:show$)/;

export async function handleCallback(
  ctx: TenantContext,
  api: TelegramApi,
  cq: TelegramCallbackQuery,
): Promise<void> {
  const from = cq.from;
  const chatId = cq.message?.chat?.id;
  const raw = cq.data ?? "";
  // Кнопка из рассылки несёт метку для счёта кликов; дальше — как без неё.
  const { data, mark } = splitClickMark(raw);
  // «В корзину» отвечает своим текстом ниже; дважды ответить на один
  // callback Telegram не даёт.
  if (!data.startsWith("add:")) await api.call("answerCallbackQuery", { callback_query_id: cq.id });
  if (!from || !chatId) return;

  // Кнопки продавца в его чате/группе — до всех покупательских гвардов.
  if (data.startsWith("confirm:") || data.startsWith("reject:"))
    return adminDecision(ctx, api, from.id, chatId, data);
  if (data.startsWith("ost:") || data.startsWith("owr:") || data.startsWith("otr:"))
    return adminOrderButton(ctx, api, from.id, chatId, data);
  // Проверка домашнего задания из уведомления преподавателю (онлайн-школа).
  if ((data.startsWith("hwa:") || data.startsWith("hwv:")) && ctx.tenant.modules.courses) {
    const { homeworkDecision } = await import("../homework-review");
    const messageId = cq.message?.message_id;
    return homeworkDecision(ctx, api, from, chatId, data, messageId ? { messageId } : undefined);
  }

  if (await isBlocked(ctx, from.id)) return;
  if (ctx.tenant.status !== "active") {
    await api.call("sendMessage", {
      chat_id: chatId,
      text: ctx.tenant.pausedMessage?.trim() || DEFAULT_PAUSED,
    });
    return;
  }
  if (mark) await recordClick(ctx, mark).catch(() => {});
  const customer = await upsertCustomer(ctx, "telegram", from.id, {
    username: from.username,
    firstName: from.first_name,
    lastName: from.last_name,
    languageCode: from.language_code,
  });
  const locale = localeOf(ctx, customer);
  const b: Bot = {
    ctx,
    api,
    chatId,
    customer,
    locale,
    m: COPY[locale],
    sells: await sellsNowOrShop(ctx),
  };

  // Кнопка «Отписаться» под рассылкой — до перехвата чатом с менеджером.
  if (data === "unsub") return optOutReply(b, "unsubscribe");

  // Нажатия кнопок — тоже в лог чата, подписью кнопки, а не сырым callback_data.
  if (ctx.tenant.modules.manager_chat) {
    const label = cq.message?.reply_markup?.inline_keyboard
      ?.flat()
      .find((btn) => btn.callback_data === raw)?.text;
    if (await inboundIntercepted(ctx, from.id, tappedButtonText(label))) return;
  }

  if (data.startsWith("locale:")) {
    const l = data.slice(7);
    if (isLocale(l)) await applyLocale(b, l);
    return;
  }
  // Язык материалов до оформления — только на этом шаге: старые кнопки
  // прошлого оформления Telegram хранит бессрочно.
  if (data.startsWith("checkoutlang:")) {
    const choice = data.slice("checkoutlang:".length);
    if (customer.state.mode !== "awaiting_delivery_lang" || !isDeliveryLangChoice(choice)) return;
    const cc = customer.state.country_code;
    b.customer = await setState(ctx, customer, {
      ...customer.state,
      mode: "idle",
      delivery_lang: choice,
    });
    if (!cc) return askCountry(b, true);
    return finishCheckout(b, cc);
  }
  // Ответ на «на каком языке» при выдаче: выдать позицию, закрыть заказ, если это был последний вопрос.
  if (data.startsWith("lang:")) {
    const [, orderIdRaw, itemId, lang] = data.split(":");
    if (!orderIdRaw || !itemId || !isLocale(lang)) return;
    return deliverInLanguage(b, Number(orderIdRaw), itemId, lang);
  }
  // Та же кнопка, нарисованная прежней платформой до переезда клиента:
  // позиция в ней — индекс, а не id (channels/telegram/legacy).
  if (data.startsWith("lang_")) {
    const legacy = parseLegacyLang(data);
    if (!legacy) return;
    const order = await getOrder(ctx, legacy.orderId);
    if (!order || order.telegram_id !== customer.telegramId) return;
    const item = legacyLangItem(order.order_items, legacy.index);
    if (!item) return;
    return deliverInLanguage(b, legacy.orderId, item.id, legacy.lang);
  }
  // «Показать ещё» под результатами поиска: запрос — в state.last_search.
  if (data.startsWith("searchmore:")) {
    const query = customer.state.last_search;
    if (typeof query !== "string" || !query) return send(b, b.m.searchExpired);
    return showSearch(b, query, parseSearchMore(data));
  }
  if (data.startsWith("setcountry:") || data.startsWith("country:")) {
    const forCheckout = data.startsWith("country:");
    const code = data.split(":")[1] ?? "";
    const method = (await listActivePaymentMethods(ctx)).find((m) => m.country_code === code);
    if (!method) return void (await askCountry(b, forCheckout));
    b.customer = await setState(ctx, customer, {
      ...customer.state,
      country_code: method.country_code,
      country_name: method.country_name,
    });
    await send(b, b.m.countrySaved(escapeHtml(method.country_name)));
    return forCheckout ? finishCheckout(b, method.country_code) : undefined;
  }
  if (NAV_NEEDS_COUNTRY.test(data) && !customer.state.country_code) return askCountry(b, false);

  if (data.startsWith("cat:")) {
    const [, id = "root", off = "0"] = data.split(":");
    return showCategories(b, id === "root" ? null : id, Number(off) || 0);
  }
  if (data.startsWith("quiz:") && ctx.tenant.modules.quiz) {
    const [, qRaw, oRaw] = data.split(":");
    const { loadQuiz, quizAnswer } = await import("@/core/quiz/quiz");
    const prev = Array.isArray(customer.state.quiz_tags)
      ? (customer.state.quiz_tags as string[])
      : [];
    const step = quizAnswer(await loadQuiz(ctx), prev, Number(qRaw), Number(oRaw));
    if (!step) return quizAsk(b, 0, true);
    b.customer = await setState(ctx, customer, { ...customer.state, quiz_tags: step.tags });
    return quizAsk(b, step.next);
  }
  // Кнопка «Участвовать» из рассылки и «Проверить ещё раз» после подписки (модуль giveaways).
  if ((data.startsWith("gw:") || data.startsWith("gwchk:")) && ctx.tenant.modules.giveaways) {
    const { giveawayEntry, giveawayIdFrom } = await import("../giveaway");
    const gid = giveawayIdFrom(data);
    if (gid) return giveawayEntry(ctx, api, chatId, customer, locale, gid);
  }
  if (data.startsWith("wait:") && ctx.tenant.modules.waitlist) {
    const { joinWaitlist } = await import("@/core/waitlist/waitlist");
    await joinWaitlist(ctx, customer, data.slice(5));
    return void (await send(b, b.m.waitlistJoined));
  }
  if (data.startsWith("prod:")) {
    const p = await getProduct(ctx, data.slice(5));
    return p ? sendProductCard(b, p) : void (await send(b, b.m.productNotFound));
  }
  if (data.startsWith("add:")) {
    const [, productId = "", variantId, from] = data.split(":");
    const r = await addToCart(ctx, customer, productId, variantId || null);
    if (r === "ok" && from === "u") {
      const { recordEngage } = await import("@/core/automsg/engage");
      await recordEngage(ctx, "upsell_add", customer.telegramId);
    }
    const text = {
      ok: b.m.added,
      unavailable: b.m.unavailable,
      mixed_cart: b.m.mixedCart,
      digital_limit: b.m.digitalLimit,
      out_of_stock: b.m.outOfStock,
      error: b.m.orderCreateFailed,
    }[r];
    await api.call("answerCallbackQuery", {
      callback_query_id: cq.id,
      text: text.slice(0, 200),
      show_alert: r !== "ok",
    });
    if (r === "ok")
      await send(b, `${b.m.added} · ${b.m.cart}`, {
        reply_markup: { inline_keyboard: [[{ text: b.m.cart, callback_data: "cart:show" }]] },
      });
    return;
  }
  if (data === "cart:show") return showCart(b);
  if (data.startsWith("rem:")) {
    await removeCartItem(ctx, customer, data.slice(4));
    return showCart(b);
  }
  if (data === "clear") {
    await clearCart(ctx, customer);
    await send(b, b.m.cartCleared);
    return;
  }
  if (data === "checkout") return startCheckout(b);
  if (data.startsWith("pay:")) {
    const [, kind, idRaw] = data.split(":");
    const order = await getOrder(ctx, Number(idRaw));
    if (!order || order.telegram_id !== customer.telegramId || order.status !== "awaiting_payment")
      return;
    const no = displayNo(order);
    const { amountDueNow } = await import("@/core/fulfillment/fulfillment");
    const due = await amountDueNow(ctx, {
      total: Number(order.total),
      fulfillment_kind: order.fulfillment_kind,
    });
    if (kind === "rk") {
      const rk = await robokassaFor(ctx, order.currency);
      if (!rk.ready) return;
      const url = buildPaymentUrl(rk, {
        outSum: due,
        invId: order.id,
        description: `Заказ #${no}`,
        botId: ctx.tenant.id,
        receipt: robokassaReceipt(rk, order, due, `Заказ #${no}`),
      });
      b.customer = await setState(ctx, customer, {
        ...customer.state,
        mode: "awaiting_payment",
        pending_order_id: order.id,
        pending_display_no: no,
      });
      await send(
        b,
        `${b.m.manualTitleNew(no)}\n\n${b.m.amountToPay(formatMoney(due, order.currency))}\n\n${b.m.robokassaHint}`,
        { reply_markup: { inline_keyboard: [[{ text: b.m.payViaRobokassaBtn, url }]] } },
      );
      return;
    }
    if (kind === "crypto") {
      const { nowpaymentsFor } = await import("@/core/payments/payment");
      const cfg = await nowpaymentsFor(ctx);
      if (!cfg.ready) return;
      const { createInvoice } = await import("@/core/payments/nowpayments");
      const username = ctx.tenant.settings.telegram?.username;
      const back = username ? `https://t.me/${username}` : ctx.appUrl;
      const inv = await createInvoice(cfg, {
        amount: due,
        currency: order.currency,
        orderId: order.id,
        description: `Заказ #${no}`,
        ipnUrl: `${ctx.appUrl}/api/nowpayments/${ctx.tenant.id}`,
        successUrl: back,
        cancelUrl: back,
      });
      if (!inv.ok) {
        console.error(`[nowpayments:${ctx.tenant.id}] счёт по заказу ${order.id}: ${inv.error}`);
        return void (await send(b, b.m.cryptoUnavailable));
      }
      b.customer = await setState(ctx, customer, {
        ...customer.state,
        mode: "awaiting_payment",
        pending_order_id: order.id,
        pending_display_no: no,
      });
      await send(
        b,
        `${b.m.manualTitleNew(no)}\n\n${b.m.amountToPay(formatMoney(due, order.currency))}\n\n${b.m.cryptoHint}`,
        { reply_markup: { inline_keyboard: [[{ text: b.m.payViaCryptoBtn, url: inv.url }]] } },
      );
      return;
    }
    if (kind === "stripe") {
      const { stripeFor } = await import("@/core/payments/payment");
      const cfg = await stripeFor(ctx);
      if (!cfg.ready) return;
      const { createCheckoutSession } = await import("@/core/payments/stripe");
      const username = ctx.tenant.settings.telegram?.username;
      const back = username ? `https://t.me/${username}` : ctx.appUrl;
      const session = await createCheckoutSession(cfg, {
        amount: due,
        currency: order.currency,
        orderId: order.id,
        botId: ctx.tenant.id,
        description: `Заказ #${no}`,
        successUrl: back,
        cancelUrl: back,
        email: order.customer_email,
      });
      if (!session.ok) {
        console.error(`[stripe:${ctx.tenant.id}] сессия по заказу ${order.id}: ${session.error}`);
        return void (await send(b, b.m.stripeUnavailable));
      }
      b.customer = await setState(ctx, customer, {
        ...customer.state,
        mode: "awaiting_payment",
        pending_order_id: order.id,
        pending_display_no: no,
      });
      await send(
        b,
        `${b.m.manualTitleNew(no)}\n\n${b.m.amountToPay(formatMoney(due, order.currency))}\n\n${b.m.stripeHint}`,
        { reply_markup: { inline_keyboard: [[{ text: b.m.payViaStripeBtn, url: session.url }]] } },
      );
      return;
    }
    if (kind === "pdm") {
      const { prodamusFor, prodamusOrderUrl } = await import("@/core/payments/payment");
      const cfg = await prodamusFor(ctx, order.currency);
      if (!cfg.ready) return;
      const username = ctx.tenant.settings.telegram?.username;
      const link = await prodamusOrderUrl(ctx, cfg, {
        orderId: order.id,
        no,
        due,
        currency: order.currency,
        back: username ? `https://t.me/${username}` : ctx.appUrl,
        email: order.customer_email,
      });
      if (!link) return;
      // Заказ в тенге, касса в рублях: к оплате — рубли, в скобках — сумма заказа.
      const sum =
        link.currency !== order.currency.toUpperCase()
          ? `${formatMoney(link.amount, link.currency)} (${formatMoney(due, order.currency)})`
          : formatMoney(due, order.currency);
      b.customer = await setState(ctx, customer, {
        ...customer.state,
        mode: "awaiting_payment",
        pending_order_id: order.id,
        pending_display_no: no,
      });
      await send(b, `${b.m.manualTitleNew(no)}\n\n${b.m.amountToPay(sum)}\n\n${b.m.prodamusHint}`, {
        reply_markup: { inline_keyboard: [[{ text: b.m.payViaProdamusBtn, url: link.url }]] },
      });
      return;
    }
    if (kind === "stars") {
      const stars = await starsDue(ctx, order);
      if (!stars) return;
      const { starsPayload } = await import("@/core/payments/stars");
      b.customer = await setState(ctx, customer, {
        ...customer.state,
        mode: "awaiting_payment",
        pending_order_id: order.id,
        pending_display_no: no,
      });
      await api.call("sendInvoice", {
        chat_id: chatId,
        title: b.m.starsInvoiceTitle(no),
        description: `${b.m.starsInvoiceDesc} · ${formatMoney(due, order.currency)}`,
        payload: starsPayload(order.id),
        currency: "XTR",
        prices: [{ label: b.m.starsInvoiceTitle(no), amount: stars }],
      });
      return;
    }
    if (kind === "manual") {
      const method =
        (await listActivePaymentMethods(ctx)).find((x) => x.country_code === order.country_code) ??
        null;
      const physical = order.fulfillment_kind === "physical";
      b.customer = await setState(ctx, customer, {
        ...customer.state,
        mode: "awaiting_proof",
        pending_order_id: order.id,
        pending_display_no: no,
      });
      const depositLine =
        physical && due < Number(order.total)
          ? `${b.m.depositLine(formatMoney(due, order.currency), formatMoney(order.total, order.currency))}\n\n`
          : "";
      return sendManualInstructions(b, {
        no,
        due,
        total: Number(order.total),
        currency: order.currency,
        instructions: method?.instructions ?? null,
        qr: method?.qr_code_path ?? null,
        physical,
        depositLine,
      });
    }
    return;
  }
  if (data.startsWith("fulfilltype:")) {
    if (customer.state.mode !== "awaiting_fulfillment_type") return;
    const type = data.slice(12);
    if (type !== "pickup" && type !== "delivery") return;
    b.customer = await setState(ctx, customer, {
      ...customer.state,
      checkout_fulfillment_type: type,
    });
    return askFulfillmentDate(b);
  }
  if (data.startsWith("slot:")) {
    if (customer.state.mode !== "awaiting_fulfillment_slot") return;
    const { fulfillmentSlots, withSlot } = await import("@/core/fulfillment/slots");
    const slot = (await fulfillmentSlots(ctx))[Number(data.slice(5))];
    const date = customer.state.checkout_fulfillment_at;
    if (!slot || !date) return askFulfillmentDate(b);
    if (!(await freeSlotsOnDate(ctx, date)).includes(slot)) {
      await send(b, b.m.fulfillmentSlotFull);
      return afterDate(b);
    }
    b.customer = await setState(ctx, customer, {
      ...customer.state,
      checkout_fulfillment_at: withSlot(date, slot),
    });
    return afterDate(b);
  }
  if (data.startsWith("prev:")) {
    const { loadPreview } = await import("@/core/catalog/preview");
    const { imageUrl } = await import("@/core/catalog/catalog");
    const keys = await loadPreview(ctx, data.slice(5));
    if (!keys.length) return;
    await b.api.call("sendMediaGroup", {
      chat_id: b.chatId,
      media: keys.map((k) => ({ type: "photo", media: imageUrl(ctx, k) })),
    });
    return;
  }
  if (data === "tkadd" && ctx.tenant.modules.helpdesk) {
    b.customer = await setState(ctx, customer, { ...customer.state, mode: "awaiting_ticket" });
    return void (await send(b, b.m.ticketPrompt));
  }
  if (data.startsWith("tkr:") && ctx.tenant.modules.helpdesk) {
    const [, ticketId = "", scoreRaw = ""] = data.split(":");
    const { rateTicket } = await import("@/core/helpdesk/tickets");
    const r = await rateTicket(ctx, ticketId, customer.telegramId, Number(scoreRaw));
    if (r === "invalid") return;
    return void (await send(
      b,
      r === "rated" ? b.m.ticketRateThanks(Number(scoreRaw)) : b.m.ticketRateAlready,
    ));
  }
  if (data.startsWith("appr:")) {
    const [, what, id] = data.split(":");
    const orderId = Number(id);
    const { data: o, error: oErr } = await ctx.db
      .from("orders")
      .select("telegram_id")
      .eq("id", orderId)
      .maybeSingle();
    if (oErr) throw serverFailure(`[telegram] заказ не прочитан: ${oErr.message}`);
    // Кнопка чужого заказа (пересланное сообщение) ничего не делает.
    if (!o || Number(o.telegram_id) !== customer.telegramId) return;
    if (what === "ok") return answerApproval(b, orderId, { ok: true });
    b.customer = await setState(ctx, customer, {
      ...customer.state,
      mode: "awaiting_approval_changes",
      approval_order_id: orderId,
    });
    return void (await send(b, b.m.approvalAskChanges));
  }
  if (data.startsWith("zone:")) {
    if (customer.state.mode !== "awaiting_delivery_zone") return;
    return pickZone(b, data.slice(5));
  }
  if (data === "fulfillnote:skip") {
    if (customer.state.mode !== "awaiting_fulfillment_note") return;
    return finishAfterNote(b, null);
  }
  if (data === "promo:enter") {
    b.customer = await setState(ctx, customer, { ...customer.state, mode: "awaiting_promo_code" });
    return void (await send(b, b.m.promoCodePrompt));
  }
  if (data === "promo:clear") {
    const { promo_code: _pc, ...rest } = customer.state;
    b.customer = await setState(ctx, customer, rest);
    await send(b, b.m.promoCodeRemoved);
    return showCart(b);
  }
  if (data === "gift:enter" && ctx.tenant.modules.bundles) {
    b.customer = await setState(ctx, customer, {
      ...customer.state,
      mode: "awaiting_gift_recipient",
    });
    return void (await send(b, b.m.giftRecipientPrompt));
  }
  if (data === "gift:skip") {
    if (customer.state.mode !== "awaiting_gift_message") return;
    b.customer = await setState(ctx, customer, { ...customer.state, mode: "idle" });
    return showCart(b);
  }
  if ((data === "gift:wrap" || data === "gift:unwrap") && ctx.tenant.modules.bundles) {
    const { gift_wrap: _gw, ...rest } = customer.state;
    b.customer = await setState(
      ctx,
      customer,
      data === "gift:wrap" ? { ...rest, gift_wrap: true } : rest,
    );
    return showCart(b);
  }
  if (data === "gift:clear") {
    const {
      gift_on: _g,
      gift_recipient: _gr,
      gift_message: _gm,
      gift_wrap: _gw,
      ...rest
    } = customer.state;
    b.customer = await setState(ctx, customer, rest);
    return showCart(b);
  }
  if (data === "giftcert:enter") {
    b.customer = await setState(ctx, customer, {
      ...customer.state,
      mode: "awaiting_gift_certificate_code",
    });
    return void (await send(b, b.m.giftCertificateCodePrompt));
  }
  if (data === "giftcert:clear") {
    const { gift_certificate_code: _gc, ...rest } = customer.state;
    b.customer = await setState(ctx, customer, rest);
    await send(b, b.m.giftCertificateRemoved);
    return showCart(b);
  }
  if (data === "points:use" || data === "points:clear") {
    const { use_points: _u, ...rest } = customer.state;
    b.customer = await setState(
      ctx,
      customer,
      data === "points:use" ? { ...rest, use_points: true } : rest,
    );
    return showCart(b);
  }
  if (data.startsWith("rate:") && ctx.tenant.modules.review_request) {
    const products = await reviewableProductsForOrder(ctx, Number(data.slice(5)), from.id);
    if (products.length === 0) return send(b, b.m.noReviewableProducts);
    if (products.length === 1) return askRating(b, products[0]!.productId, products[0]!.name);
    return send(b, b.m.chooseProductToRate, {
      reply_markup: {
        inline_keyboard: products.map((p) => [
          { text: p.name, callback_data: `rateproduct:${p.productId}` },
        ]),
      },
    });
  }
  if (data.startsWith("rateproduct:") && ctx.tenant.modules.review_request) {
    const productId = data.slice(12);
    if (!(await hasDeliveredPurchase(ctx, from.id, productId)))
      return send(b, b.m.reviewNotAllowed);
    const p = await getProduct(ctx, productId);
    return askRating(b, productId, p?.name ?? "");
  }
  if (data.startsWith("stars:") && ctx.tenant.modules.review_request) {
    const [, productId = "", raw = ""] = data.split(":");
    const rating = Number(raw);
    if (!isValidRating(rating)) return;
    if (!(await hasDeliveredPurchase(ctx, from.id, productId)))
      return send(b, b.m.reviewNotAllowed);
    await saveRating(ctx, from.id, productId, rating);
    b.customer = await setState(ctx, b.customer, {
      ...b.customer.state,
      mode: "awaiting_review_comment",
      review_product_id: productId,
    });
    return send(b, b.m.reviewSaved, {
      reply_markup: {
        inline_keyboard: [[{ text: b.m.reviewSkipBtn, callback_data: "reviewskip" }]],
      },
    });
  }
  if (data === "reviewskip") {
    const { review_product_id: _rp, ...rest } = b.customer.state;
    b.customer = await setState(ctx, b.customer, { ...rest, mode: "idle" });
    return send(b, b.m.useMenu);
  }
  if (data.startsWith("balance:")) {
    const order = await getOrder(ctx, Number(data.slice(8)));
    if (!order || order.telegram_id !== customer.telegramId) return;
    return showBalancePayment(b, order);
  }
  if (data.startsWith("subren:")) {
    // Продление товара-подписки (core/catalog/subscription): товар из прошлого заказа — в корзину.
    const [, orderRaw, productId = ""] = data.split(":");
    const order = await getOrder(ctx, Number(orderRaw));
    if (!order || order.telegram_id !== customer.telegramId) return;
    const item = order.order_items.find((i) => i.product_id === productId);
    if (!item) return;
    const r = await addToCart(ctx, customer, productId, item.product_variant_id ?? null);
    if (r !== "ok") return void (await send(b, b.m.renewUnavailable));
    return startCheckout(b);
  }
  if (data.startsWith("suboff:")) {
    const { withSubscriptionOff } = await import("@/core/catalog/subscription");
    b.customer = await setState(
      ctx,
      customer,
      withSubscriptionOff(customer.state, data.slice(7), true),
    );
    return void (await send(b, b.m.subOffDone));
  }
  if (data.startsWith("hw:") && ctx.tenant.modules.courses) return startHomework(b, data);
  if ((data.startsWith("lsl:") || data.startsWith("lsn:")) && ctx.tenant.modules.courses) {
    const { showLessonList, showLesson } = await import("../courses");
    return data.startsWith("lsl:") ? showLessonList(b, data) : showLesson(b, data);
  }
  if (/^q[zad]:/.test(data) && ctx.tenant.modules.courses) {
    const { startQuiz, answerQuiz } = await import("../course-quiz");
    return data.startsWith("qz:")
      ? startQuiz(b, data)
      : answerQuiz(b, data, cq.message?.message_id);
  }
  if (data.startsWith("opl:") && ctx.tenant.modules.courses) {
    const { showOpenLesson } = await import("../courses");
    return showOpenLesson(b, data);
  }
  if (data.startsWith("lv:") && ctx.tenant.modules.courses) {
    const { showLives } = await import("../courses");
    return showLives(b, data);
  }
  if ((data.startsWith("cinv:") || data.startsWith("cchat:")) && ctx.tenant.modules.courses)
    return sendChannelInvite(b, data);
  if (data.startsWith("reorder:")) {
    const order = await getOrder(ctx, Number(data.slice(8)));
    if (!order || order.telegram_id !== customer.telegramId) return;
    return reorderFrom(b, order);
  }
  if (data.startsWith("resend:")) {
    const order = await getOrder(ctx, Number(data.slice(7)));
    // Старая или подделанная кнопка: только свой выданный цифровой заказ.
    if (!order || order.telegram_id !== customer.telegramId) return;
    if (!(await reopenForResend(ctx, order))) return;
    const r = await deliverOrder(ctx, order.id, telegramMaterialSender(api, chatId, b.m), {
      lang: locale,
      ask: telegramLanguageAsker(api, chatId, b.m),
    });
    if (!r.alreadyDelivered && r.pending === 0) await send(b, b.m.orderDelivered(displayNo(order)));
    return;
  }
}
