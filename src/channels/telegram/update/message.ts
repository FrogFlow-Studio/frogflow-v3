// Входящие сообщения: разбор текста, файлов и кнопок меню.
import { isReorderWord } from "@/core/orders/reorder-words";
import { saveComment } from "@/core/reviews/reviews";
import { inboundIntercepted, inboundLogText } from "@/core/chat/chat";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { TelegramApi } from "../api";
import { notUnderstoodHtml } from "../screens";
import { isHomeworkMessage, receiveHomework } from "../courses";
import type { TelegramMessage } from "../types";
import { COPY, escapeHtml, menuActionFor, menuWordFor, normalizePhone } from "../copy";
import { isBlocked, setContactPhone, setState, upsertCustomer } from "@/core/customers/customers";
import { recentAwaitingPaymentOrder } from "@/core/orders/orders";
import { optOutCommand, optOutWordsApply, setOptOut } from "@/core/customers/opt-out";
import { notifyAdminsHtml } from "../notify";
import { botCommandFor } from "../commands";
import { findValidGift, findValidPromoCode } from "@/core/discounts/discounts";
import { normalizeCode } from "@/core/discounts/pure";
import {
  activeDeliveryZones,
  checkFulfillmentDate,
  earliestFulfillmentDate,
} from "@/core/fulfillment/fulfillment";
import { closedRules } from "@/core/fulfillment/closed-days";
import { dateAvailability, freeSlotsOnDate } from "@/core/fulfillment/capacity";
import { isoToDisplay, matchFulfillmentType, parseDateInput } from "@/core/fulfillment/pure";
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
import { showCart } from "./cart";
import { freeTextSearch, isFreeTextQuery, showSearch } from "./catalog";
import {
  afterDate,
  answerApproval,
  askFulfillmentDate,
  askNote,
  askZoneOrAddress,
  continueCheckout,
  finishAfterNote,
  pickZone,
} from "./checkout";
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

  if (text && !action) {
    const mode = customer.state.mode;
    if (mode === "awaiting_fulfillment_type") {
      const type = matchFulfillmentType(text);
      if (!type) return void (await send(b, b.m.fulfillmentTypePrompt));
      b.customer = await setState(ctx, customer, {
        ...customer.state,
        checkout_fulfillment_type: type,
      });
      return askFulfillmentDate(b);
    }
    if (mode === "awaiting_fulfillment_date") {
      const iso = parseDateInput(text);
      const rules = await closedRules(ctx);
      // Минимум — на сегодня, а не на момент вопроса: за ночь срок изготовления, нерабочие дни
      // и лимит могли измениться; сохранённая дата нужна только для текста подсказки.
      const minIso = await earliestFulfillmentDate(ctx, customer, rules);
      if (!iso) return void (await send(b, b.m.fulfillmentDateInvalid));
      const check = checkFulfillmentDate(iso, minIso, rules);
      if (!check.ok)
        return void (await send(
          b,
          check.reason === "early"
            ? b.m.fulfillmentDateTooEarly(isoToDisplay(check.minDate))
            : b.m.fulfillmentDateClosed(isoToDisplay(check.nextDate)),
        ));
      const avail = await dateAvailability(ctx, iso, rules);
      if (!avail.ok)
        return void (await send(
          b,
          b.m.fulfillmentDateFull(avail.nextDate ? isoToDisplay(avail.nextDate) : null),
        ));
      b.customer = await setState(ctx, customer, {
        ...customer.state,
        checkout_fulfillment_at: iso,
      });
      return afterDate(b);
    }
    if (mode === "awaiting_fulfillment_slot") {
      const { fulfillmentSlots, normalizeSlot, withSlot } =
        await import("@/core/fulfillment/slots");
      const date = customer.state.checkout_fulfillment_at;
      const wanted = (await fulfillmentSlots(ctx)).find((x) => x === normalizeSlot(text));
      const free = date ? await freeSlotsOnDate(ctx, date) : [];
      if (wanted && !free.includes(wanted)) await send(b, b.m.fulfillmentSlotFull);
      const slot = free.find((x) => x === wanted);
      if (slot && date)
        b.customer = await setState(ctx, customer, {
          ...customer.state,
          checkout_fulfillment_at: withSlot(date, slot),
        });
      return afterDate(b);
    }
    if (mode === "awaiting_delivery_zone") {
      const zones = await activeDeliveryZones(ctx);
      const z =
        zones.find((x) => x.name.trim().toLowerCase() === text.trim().toLowerCase()) ??
        zones.find((x) => text.toLowerCase().includes(x.name.toLowerCase()));
      return z ? pickZone(b, z.id) : askZoneOrAddress(b);
    }
    if (mode === "awaiting_address") {
      b.customer = await setState(ctx, customer, {
        ...customer.state,
        checkout_fulfillment_address: text.slice(0, 500),
      });
      return askNote(b);
    }
    if (mode === "awaiting_fulfillment_note") return finishAfterNote(b, text.slice(0, 500));
  }

  if (customer.state.mode === "awaiting_ticket" && text && !action && ctx.tenant.modules.helpdesk) {
    b.customer = await setState(ctx, customer, { ...customer.state, mode: "idle" });
    const { createTicket } = await import("@/core/helpdesk/tickets");
    const who = customer.firstName || (customer.username ? `@${customer.username}` : null);
    const { ticket, created } = await createTicket(ctx, {
      telegramId: from.id,
      customerName: who,
      platform: "telegram",
      subject: text,
    });
    if (ctx.tenant.modules.manager_chat) {
      const { recordMessage } = await import("@/core/chat/chat");
      await recordMessage(ctx, { telegramId: from.id, direction: "in", sender: "customer", text });
    }
    const { noticeLocale, ticketNoticeText } = await import("@/core/helpdesk/seller-texts");
    await notifyAdminsHtml(
      ctx,
      ticketNoticeText(
        await noticeLocale(ctx),
        created,
        ticket.number,
        `👤 ${escapeHtml(who ?? String(from.id))}`,
        escapeHtml(text.slice(0, 1000)),
      ),
      { kind: "question" },
    ).catch(() => 0);
    await send(b, created ? b.m.ticketCreated(ticket.number) : b.m.ticketAppended(ticket.number));
    return;
  }
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
  if (customer.state.mode === "awaiting_birthday" && text && !action) {
    const { parseBirthday, setCustomerBirthday } = await import("@/core/funnel/birthday");
    const day = parseBirthday(text);
    if (!day) return void (await send(b, b.m.birthdayInvalid));
    await setCustomerBirthday(
      ctx,
      { ...customer, state: { ...customer.state, mode: "idle" } },
      day,
    );
    return void (await send(b, b.m.birthdaySaved));
  }
  if (customer.state.mode === "awaiting_review_comment") {
    const { review_product_id: productId, ...rest } = customer.state;
    b.customer = await setState(ctx, customer, { ...rest, mode: "idle" });
    if (text && !action && productId) {
      await saveComment(ctx, from.id, productId, text);
      await send(b, b.m.reviewCommentSaved);
      return;
    }
  }
  if (customer.state.mode === "awaiting_promo_code" && text && !action) {
    const idle = { ...customer.state, mode: "idle" as const };
    const found = await findValidPromoCode(ctx, text, customer);
    if (!found.ok) {
      b.customer = await setState(ctx, customer, idle);
      await send(b, found.reason === "used_by_buyer" ? b.m.promoCodeUsed : b.m.promoCodeInvalid);
    } else {
      b.customer = await setState(ctx, customer, { ...idle, promo_code: normalizeCode(text) });
    }
    return showCart(b);
  }
  if (customer.state.mode === "awaiting_gift_recipient" && text && !action) {
    const { normalizeGift, GIFT_NAME_MAX } = await import("@/core/orders/gift");
    const g = normalizeGift({ recipient: text });
    b.customer = await setState(ctx, customer, {
      ...customer.state,
      mode: "awaiting_gift_message",
      gift_on: true,
      gift_recipient: g.recipient,
    });
    if (g.truncated) await send(b, b.m.giftTruncatedNote(GIFT_NAME_MAX));
    return void (await send(b, b.m.giftMessagePrompt, {
      reply_markup: {
        inline_keyboard: [[{ text: b.m.giftSkipBtn, callback_data: "gift:skip" }]],
      },
    }));
  }
  if (customer.state.mode === "awaiting_gift_message" && text && !action) {
    const { normalizeGift, GIFT_MESSAGE_MAX } = await import("@/core/orders/gift");
    const g = normalizeGift({ message: text });
    b.customer = await setState(ctx, customer, {
      ...customer.state,
      mode: "idle",
      gift_on: true,
      gift_message: g.message,
    });
    if (g.truncated) await send(b, b.m.giftTruncatedNote(GIFT_MESSAGE_MAX));
    return showCart(b);
  }
  if (customer.state.mode === "awaiting_gift_certificate_code" && text && !action) {
    const idle = { ...customer.state, mode: "idle" as const };
    const found = await findValidGift(ctx, text);
    if (!found.ok) {
      b.customer = await setState(ctx, customer, idle);
      await send(b, b.m.giftCertificateInvalid);
    } else {
      b.customer = await setState(ctx, customer, {
        ...idle,
        gift_certificate_code: normalizeCode(text),
      });
    }
    return showCart(b);
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
