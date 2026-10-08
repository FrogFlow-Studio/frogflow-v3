// Входящие сообщения: разбор текста, файлов и кнопок меню.
import { isReorderWord } from "@/core/orders/reorder-words";
import { saveComment } from "@/core/reviews/reviews";
import { inboundIntercepted, inboundLogText } from "@/core/chat/chat";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { TelegramApi } from "../api";
import { notUnderstoodHtml } from "../screens";
import { isHomeworkMessage, receiveHomework } from "../courses";
import type { TelegramMessage } from "../types";
import { COPY, menuActionFor, menuWordFor, normalizePhone } from "../copy";
import { isBlocked, setContactPhone, setState, upsertCustomer } from "@/core/customers/customers";
import { recentAwaitingPaymentOrder } from "@/core/orders/orders";
import { optOutCommand, optOutWordsApply, setOptOut } from "@/core/customers/opt-out";
import { botCommandFor } from "../commands";
import { sellsNowOrShop } from "@/core/tenant/sells.server";
import {
  type Bot,
  contactLabels,
  DEFAULT_PAUSED,
  localeOf,
  mainMenu,
  send,
  sendMain,
  SHOP_ACTIONS,
} from "./bot";
import { freeTextSearch, isFreeTextQuery, showSearch } from "./catalog";
import { answerApproval, continueCheckout } from "./checkout";
import { consultantReply, offHoursReply, pricelistPhoto, questionToManager } from "./conversation";
import { receiveReviewPhoto, reorderLast } from "./orders";
import {
  downloadTelegramFile,
  ownerInvoiceProof,
  receiveBalanceProof,
  receiveProof,
} from "./payments";
import { relayManagerReply, relayOrderReply, trackReply } from "./seller";
import { botCommand, menuAction, optOutReply, startFlow } from "./start";
import {
  CHECKOUT_TEXT_MODES,
  checkoutTextStep,
  ticketText,
  TYPED_INPUT_MODES,
  typedInput,
} from "./message-steps";

// ── входящие сообщения ────────────────────────────────────────────────

export async function handleMessage(
  ctx: TenantContext,
  api: TelegramApi,
  msg: TelegramMessage,
): Promise<void> {
  const from = msg.from;
  if (!from) return;
  const chatId = msg.chat.id;

  // /id — до всех гвардов и в любом чате: продавец узнаёт свой id (и id
  // группы) для настроек уведомлений ещё до того, как магазин настроен.
  if (/^\/id(@\w+)?$/.test(msg.text?.trim() ?? "")) {
    const m = COPY[ctx.tenant.settings.default_locale ?? "ru"];
    const text =
      chatId === from.id
        ? m.yourId(from.id)
        : `${m.yourId(from.id)}\nID этого чата: <code>${chatId}</code>`;
    await api.call("sendMessage", { chat_id: chatId, text, parse_mode: "HTML" });
    return;
  }
  // Преподаватель ответил свайпом на уведомление о домашнем задании — и в
  // личке, и в группе продавца (admin_chat_id бывает группой).
  if (msg.reply_to_message && msg.text?.trim()) {
    const { homeworkReply } = await import("../homework-review");
    if (await homeworkReply(ctx, api, msg)) return;
  }
  if (msg.chat.type !== undefined && msg.chat.type !== "private") return;

  // Менеджер ответил свайпом на уведомление о передаче — ответ покупателю в Direct.
  if (msg.reply_to_message && msg.text?.trim() && (await relayManagerReply(ctx, api, msg))) return;
  // Продавец ответил свайпом на «Написать покупателю» под уведомлением о заказе.
  if (msg.reply_to_message && msg.text?.trim() && (await relayOrderReply(ctx, api, msg))) return;
  // Продавец ответил номером на «Отправлен + трек».
  if (msg.reply_to_message && msg.text?.trim() && (await trackReply(ctx, api, msg))) return;

  // Чек по счёту оператора от владельца бота — до гварда паузы: счёт и
  // выставляется как раз тогда, когда бот приостановлен за просрочку.
  if ((msg.photo || msg.document) && (await ownerInvoiceProof(ctx, api, msg))) return;

  if (await isBlocked(ctx, from.id)) return;
  if (ctx.tenant.status !== "active") {
    await api.call("sendMessage", {
      chat_id: chatId,
      text: ctx.tenant.pausedMessage?.trim() || DEFAULT_PAUSED,
    });
    return;
  }

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
  const text = msg.text?.trim();

  // Чат с менеджером: реплика в лог; если менеджер подключён — бот молчит.
  // Исключения: /start (покупатель хочет меню) и чек на шаге оплаты.
  const proofStep =
    (customer.state.mode === "awaiting_proof" ||
      customer.state.mode === "awaiting_balance_proof") &&
    Boolean(msg.photo || msg.document);
  const intercepted = await inboundIntercepted(ctx, from.id, inboundLogText(msg));
  // «Отписаться» / «подписаться» словом — вне оформления; и при чате с менеджером.
  const optCmd = optOutWordsApply(customer.state.mode) ? optOutCommand(text) : null;
  if (optCmd) return optOutReply(b, optCmd);
  // Команды из меню «/» — как /start: работают и при чате с менеджером.
  const command = botCommandFor(text);
  if (command) return botCommand(b, command);
  if (intercepted && !text?.startsWith("/start") && !proofStep) return;

  if (text?.startsWith("/start")) {
    // /start возвращает отписавшегося к рассылкам.
    if (await setOptOut(ctx, customer.userKey, false)) await send(b, b.m.resubscribed);
    return startFlow(b, text.slice(6).trim());
  }

  // Телефон на шаге оформления — кнопкой или текстом.
  if (customer.state.mode === "awaiting_contact") {
    const phone = msg.contact?.phone_number ?? (text ? normalizePhone(text) : null);
    const action = menuActionFor(text, contactLabels(ctx));
    if (!phone && !action) {
      await send(b, b.m.phoneInvalid);
      return;
    }
    if (phone) {
      b.customer = await setContactPhone(ctx, customer, phone);
      b.customer = await setState(ctx, b.customer, { ...b.customer.state, mode: "idle" });
      await send(b, b.m.contactSaved, { reply_markup: mainMenu(b) });
      return continueCheckout(b);
    }
  }

  // Ответ на домашнее задание (онлайн-школа) — до чека: фото работы — не
  // оплата. Кнопка меню или команда выводят из ожидания ответа.
  if (ctx.tenant.modules.courses && isHomeworkMessage(customer, msg)) {
    const menu = menuActionFor(text, contactLabels(ctx));
    if (!menu && !text?.startsWith("/"))
      return receiveHomework(b, msg, (id) =>
        downloadTelegramFile(b.api, id).then((f) => f?.bytes ?? null),
      );
    b.customer = await setState(ctx, customer, {
      ...customer.state,
      mode: "idle",
      hw_group: undefined,
    });
  }

  // Фото к отзыву — до чека: на шаге комментария покупатель шлёт снимок
  // товара, а не оплату, даже если у него есть неоплаченный заказ.
  if (
    customer.state.mode === "awaiting_review_comment" &&
    customer.state.review_product_id &&
    (msg.photo || msg.document) &&
    ctx.tenant.modules.review_request
  )
    return receiveReviewPhoto(b, msg, String(customer.state.review_product_id));

  // Чек на остаток по задатку — после кнопки «Оплатить остаток».
  if (
    customer.state.mode === "awaiting_balance_proof" &&
    customer.state.pending_order_id &&
    (msg.photo || msg.document)
  )
    return receiveBalanceProof(b, msg, Number(customer.state.pending_order_id));

  // Чек оплаты: по состоянию либо по свежему открытому заказу.
  if (msg.photo || msg.document) {
    const proofModes = new Set(["awaiting_proof", "awaiting_payment"]);
    let orderId =
      proofModes.has(String(customer.state.mode)) && customer.state.pending_order_id
        ? Number(customer.state.pending_order_id)
        : null;
    if (!orderId) orderId = await recentAwaitingPaymentOrder(ctx, customer);
    if (orderId) return receiveProof(b, msg, orderId);
  }

  // Консультант без товаров: «Каталог», «Поиск», «Корзина» со старого нижнего
  // меню — не в пустой каталог, а вопросом консультанту.
  const pressed = menuActionFor(text, contactLabels(ctx));
  const action = pressed && !b.sells && SHOP_ACTIONS.has(pressed) ? undefined : pressed;

  if (text && !action && CHECKOUT_TEXT_MODES.has(customer.state.mode))
    return checkoutTextStep(b, customer, text);

  if (customer.state.mode === "awaiting_ticket" && text && !action && ctx.tenant.modules.helpdesk)
    return ticketText(b, customer, text, from.id);
  // Правки к фото готового заказа (core/orders/approval) — после «Нужны правки».
  if (
    customer.state.mode === "awaiting_approval_changes" &&
    customer.state.approval_order_id &&
    text &&
    !action
  ) {
    const orderId = Number(customer.state.approval_order_id);
    const { approval_order_id: _ao, ...rest } = customer.state;
    b.customer = await setState(ctx, customer, { ...rest, mode: "idle" });
    await answerApproval(b, orderId, { ok: false, text });
    return;
  }
  if (text && !action && TYPED_INPUT_MODES.has(customer.state.mode))
    return typedInput(b, customer, text);
  if (customer.state.mode === "awaiting_review_comment") {
    const { review_product_id: productId, ...rest } = customer.state;
    b.customer = await setState(ctx, customer, { ...rest, mode: "idle" });
    if (text && !action && productId) {
      await saveComment(ctx, from.id, productId, text);
      await send(b, b.m.reviewCommentSaved);
      return;
    }
  }

  if (
    (customer.state.mode === "awaiting_proof" ||
      customer.state.mode === "awaiting_balance_proof") &&
    customer.state.pending_order_id &&
    !action
  ) {
    await send(b, b.m.sendReceiptPrompt);
    return;
  }
  if (action) {
    if (customer.state.mode && customer.state.mode !== "idle") {
      b.customer = await setState(ctx, customer, { ...customer.state, mode: "idle" });
    }
    return menuAction(b, action);
  }
  if (
    text &&
    (!customer.state.mode || customer.state.mode === "idle" || customer.state.mode === "search")
  )
    await offHoursReply(b);
  if (customer.state.mode === "search" && text && b.sells) return showSearch(b, text);
  // «Как в прошлый раз» словом: последний оплаченный заказ в корзину (Б11).
  if (text && b.sells && isReorderWord(text) && (await reorderLast(b))) return;
  if (text && (await consultantReply(b, text, { messageId: msg.message_id, date: msg.date })))
    return;
  // Консультант без товаров не ответил: не поиск по пустому каталогу, а вопрос менеджеру.
  if (text && !b.sells) return questionToManager(b, text);
  const word = menuWordFor(text);
  if (word) return menuAction(b, word);
  if (text && isFreeTextQuery(text)) return freeTextSearch(b, text);
  // Консультант по прайсу видит фото покупателя (не чек — чеки разобраны выше).
  if (msg.photo?.length && !text && (await pricelistPhoto(b, msg))) return;
  await sendMain(b, notUnderstoodHtml(ctx.tenant, b.locale));
}
