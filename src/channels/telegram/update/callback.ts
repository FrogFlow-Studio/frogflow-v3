// Нажатия инлайн-кнопок покупателя.
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
import { isBlocked, setState, upsertCustomer } from "@/core/customers/customers";
import { clearCart, removeCartItem } from "@/core/cart/cart";
import {
  deliverOrder,
  displayNo,
  getOrder,
  listActivePaymentMethods,
  reopenForResend,
} from "@/core/orders/orders";
import { telegramLanguageAsker, telegramMaterialSender } from "../deliver";
import { legacyLangItem, parseLegacyLang, parseSearchMore } from "../legacy";
import { sellsNowOrShop } from "@/core/tenant/sells.server";
import { type Bot, DEFAULT_PAUSED, localeOf, send } from "./bot";
import { showCart } from "./cart";
import { quizAsk, sendProductCard, showCategories, showSearch } from "./catalog";
import { askCountry, finishCheckout, startCheckout } from "./checkout";
import { deliverInLanguage, reorderFrom } from "./orders";
import { showBalancePayment } from "./payments";
import { adminDecision, adminOrderButton } from "./seller";
import { applyLocale, optOutReply } from "./start";
import { payButton } from "./callback-pay";
import { addToCartButton, cartOptionButton, checkoutStepButton } from "./callback-checkout";
import { reviewButton, subscriptionButton } from "./callback-orders";

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
  if (data.startsWith("add:")) return addToCartButton(b, customer, data, cq.id);
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
  if (data.startsWith("pay:")) return payButton(b, customer, data);
  if (/^(fulfilltype|slot|appr|zone):/.test(data) || data === "fulfillnote:skip")
    return checkoutStepButton(b, customer, data);
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
  if (/^(promo|gift|giftcert|points):/.test(data)) return cartOptionButton(b, customer, data);
  if (/^(rate|rateproduct|stars):/.test(data) || data === "reviewskip")
    return reviewButton(b, customer, data, from.id);
  if (data.startsWith("balance:")) {
    const order = await getOrder(ctx, Number(data.slice(8)));
    if (!order || order.telegram_id !== customer.telegramId) return;
    return showBalancePayment(b, order);
  }
  if (/^sub(ren|off):/.test(data)) return subscriptionButton(b, customer, data);
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
