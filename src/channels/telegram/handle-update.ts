import { isReorderWord } from "@/core/orders/reorder-words";
import { lastPaidOrder, shortLabels } from "@/core/orders/reorder";
import { orderBuyerLocale } from "@/core/orders/buyer-locale";
import {
  REFERRAL_PREFIX,
  referralStats,
  registerReferral,
  type ReferralGrant,
} from "@/core/referrals/referrals";
import { orderChannel } from "@/core/orders/pure";
import { notifyReferralReward } from "./referral-notify";
import {
  hasDeliveredPurchase,
  reviewableProductsForOrder,
  saveComment,
  saveRating,
} from "@/core/reviews/reviews";
import { isValidRating } from "@/core/reviews/pure";
import { inboundIntercepted, inboundLogText, tappedButtonText } from "@/core/chat/chat";
import { recordClick, splitClickMark } from "@/core/broadcasts/clicks";
import { adminRecipients } from "@/core/notify/recipients";
import { PRODUCT_SELECT } from "@/core/catalog/catalog";
import { isDeliveryLangChoice } from "@/core/catalog/materials";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { TelegramApi } from "./api";
import {
  languageChoice,
  mainMenu as screenMainMenu,
  notUnderstoodHtml,
  offHoursHtml,
  orderThanksHtml,
  productCard,
  welcomeHtml,
} from "./screens";
import { cleanWorkHours, outsideWorkHours } from "@/core/bot-texts/registry";
import { makeReason } from "@/core/chat/reason";
import {
  isHomeworkMessage,
  receiveHomework,
  sendChannelInvite,
  showMyCourses,
  startHomework,
} from "./courses";
import type { InlineButton, TelegramCallbackQuery, TelegramMessage, TelegramUpdate } from "./types";
import {
  COPY,
  categoryButtonLabel,
  escapeHtml,
  menuActionFor,
  menuWordFor,
  minOrderText,
  freeDeliveryText,
  normalizePhone,
  type Msg,
} from "./copy";
import {
  isLocale,
  localeFlags,
  localeNames,
  SUPPORTED_LOCALES,
  type Locale,
} from "@/core/i18n/locale";
import { verticalDef } from "@/core/verticals/registry";
import { storefrontBase } from "@/core/tenant/custom-domain";
import { formatMoney } from "@/core/money/money";
import {
  upsertCustomer,
  getCustomer,
  setState,
  setContactPhone,
  isBlocked,
  type Customer,
} from "@/core/customers/customers";
import {
  categoryParentId,
  getProduct,
  imageUrl,
  listChildCategories,
  listProductsInCategory,
  searchProductsTolerant,
  type Product,
} from "@/core/catalog/catalog";
import { resolvePrice } from "@/core/pricing/pricing";
import {
  addToCart,
  cartCount,
  clearCart,
  listCart,
  priceCart,
  removeCartItem,
} from "@/core/cart/cart";
import { belowMinimum } from "@/core/cart/min-order";
import { freeDeliveryView } from "@/core/fulfillment/free-delivery-cart";
import {
  attachPaymentProof,
  markProofVerified,
  PROOF_SWAPPED_NOTE,
  canResendMaterials,
  cartSummary,
  deliverOrder,
  displayNo,
  getOrder,
  listActivePaymentMethods,
  listCustomerOrders,
  placeOrder,
  recentAwaitingPaymentOrder,
  rejectOrder,
  reorderReport,
  reopenForResend,
  completeLanguageDelivery,
} from "@/core/orders/orders";
import { getSetting } from "@/core/settings/settings";
import {
  optOutCommand,
  optOutWordsApply,
  setOptOut,
  type OptOutCommand,
} from "@/core/customers/opt-out";
import { shopAdminIds } from "@/core/notify/recipients";
import { notifyAdminNewOrder } from "./admin-notify";
import { notifyAdminsHtml, notifyBalanceProof, notifyDeliveryFailure } from "./notify";
import {
  attachBalanceProof,
  balanceDue,
  balancePayable,
  balanceProofPending,
  claimBalanceInvId,
} from "@/core/orders/balance";
import { telegramLanguageAsker, telegramMaterialSender } from "./deliver";
import { botCommandFor, type BotCommand } from "./commands";
import { legacyLangItem, parseLegacyLang, parseSearchMore, searchPage } from "./legacy";
import { findValidGift, findValidPromoCode, shopCurrency } from "@/core/discounts/discounts";
import { customerTierStatus } from "@/core/loyalty/tiers";
import { normalizeCode } from "@/core/discounts/pure";
import { claimHandoff, HANDOFF_PREFIX } from "@/core/storefront/handoff";
import { parseWaitlistPayload, shouldJoinWaitlist } from "@/core/waitlist/link";
import { robokassaFor, robokassaReceipt } from "@/core/payments/payment";
import { buildPaymentUrl } from "@/core/payments/robokassa";
import {
  activeDeliveryZones,
  fulfillmentSettings,
  checkFulfillmentDate,
  earliestFulfillmentDate,
  zoneFee,
} from "@/core/fulfillment/fulfillment";
import { closedRules, describeClosed, hasClosedDays } from "@/core/fulfillment/closed-days";
import { dateAvailability, freeSlotsOnDate } from "@/core/fulfillment/capacity";
import { isoToDisplay, matchFulfillmentType, parseDateInput } from "@/core/fulfillment/pure";
import { serverFailure } from "@/lib/server-failure";

const PAGE = 5;
const DEFAULT_PAUSED = "Бот временно недоступен. Загляните чуть позже — мы уже разбираемся.";

/**
 * Адаптер Telegram: разбирает обновление, зовёт ядро, рисует ответ.
 * Ни одной бизнес-проверки здесь нет — они в core/*. Канал знает про
 * клавиатуры, HTML и file_id; ядро — про корзину, заказы и цены.
 */
export async function handleTelegramUpdate(
  ctx: TenantContext,
  api: TelegramApi,
  update: TelegramUpdate,
): Promise<void> {
  try {
    if (update.callback_query) return await handleCallback(ctx, api, update.callback_query);
    if (update.pre_checkout_query)
      return await handlePreCheckout(ctx, api, update.pre_checkout_query);
    if (update.message?.successful_payment) return await handleStarsPaid(ctx, api, update.message);
    if (update.message) return await handleMessage(ctx, api, update.message);
    if (update.chat_member) {
      const { handleCourseChannelMember } = await import("./courses");
      return await handleCourseChannelMember(ctx, update.chat_member);
    }
  } catch (e) {
    const { reportError } = await import("@/lib/errors");
    await reportError(e, {
      where: "telegram.update",
      botId: ctx.tenant.id,
      extra: {
        update_id: update.update_id,
        kind: update.callback_query ? "callback" : update.message ? "message" : "other",
      },
    });
  }
}

type Bot = {
  ctx: TenantContext;
  api: TelegramApi;
  chatId: number;
  customer: Customer;
  locale: Locale;
  m: Msg;
};

function localeOf(ctx: TenantContext, customer: Customer): Locale {
  const fromState = customer.state.locale;
  if (isLocale(fromState)) return fromState;
  return ctx.tenant.settings.default_locale ?? "ru";
}

async function send(b: Bot, text: string, extra: Record<string, unknown> = {}): Promise<void> {
  await b.api.call("sendMessage", {
    chat_id: b.chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...extra,
  });
}

function contactLabels(ctx: TenantContext): string[] {
  const def = verticalDef(ctx.tenant.vertical);
  return SUPPORTED_LOCALES.map((l) => def.locales[l].contactBtn);
}

function mainMenu(b: Bot) {
  return screenMainMenu(b.ctx.tenant, b.locale, b.ctx.appUrl);
}

async function sendMain(b: Bot, text?: string) {
  await send(b, text ?? b.m.chooseSection, { reply_markup: mainMenu(b) });
}

/** Показать корзину покупателю извне (Mini App перенёс позиции). */
export async function sendCartMessage(
  ctx: TenantContext,
  api: TelegramApi,
  customer: Customer,
): Promise<void> {
  const locale = localeOf(ctx, customer);
  await showCart({ ctx, api, chatId: customer.telegramId, customer, locale, m: COPY[locale] });
}

// ── входящие сообщения ────────────────────────────────────────────────

async function handleMessage(
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
    const { homeworkReply } = await import("./homework-review");
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
  const b: Bot = { ctx, api, chatId, customer, locale, m: COPY[locale] };
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

  const action = menuActionFor(text, contactLabels(ctx));

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
  if (customer.state.mode === "search" && text) return showSearch(b, text);
  // «Как в прошлый раз» словом: последний оплаченный заказ в корзину (Б11).
  if (text && isReorderWord(text) && (await reorderLast(b))) return;
  if (text && (await consultantReply(b, text))) return;
  const word = menuWordFor(text);
  if (word) return menuAction(b, word);
  if (text && isFreeTextQuery(text)) return freeTextSearch(b, text);
  // Консультант по прайсу видит фото покупателя (не чек — чеки разобраны выше).
  if (msg.photo?.length && !text && (await pricelistPhoto(b, msg))) return;
  await sendMain(b, notUnderstoodHtml(ctx.tenant, b.locale));
}

/** Не чаще раза в 6 часов одному покупателю: «вне часов работы» не должно сыпаться на каждую реплику. */
const OFF_HOURS_REPEAT_MS = 6 * 3_600_000;

/**
 * Текст «вне часов работы»: только если продавец задал рабочие часы и сейчас
 * вне них. Отметка ставится до отправки: повтор события не пошлёт второй раз.
 */
async function offHoursReply(b: Bot) {
  const tenant = b.ctx.tenant;
  const hours = cleanWorkHours(tenant.settings.work_hours);
  if (!hours || !outsideWorkHours(tenant, new Date(), b.ctx.timezone)) return;
  const last = Date.parse(String(b.customer.state.off_hours_at ?? ""));
  if (Number.isFinite(last) && Date.now() - last < OFF_HOURS_REPEAT_MS) return;
  b.customer = await setState(b.ctx, b.customer, {
    ...b.customer.state,
    off_hours_at: new Date().toISOString(),
  });
  await send(b, offHoursHtml(tenant, b.locale, hours));
}

/** Повторить заказ: те же товары в корзину по текущим ценам и остаткам; чего нет — названо. */
async function reorderFrom(b: Bot, order: import("@/core/orders/orders").OrderWithItems) {
  const report = await reorderReport(b.ctx, b.customer, order);
  const missing = report.short.length ? b.m.reorderShort(shortLabels(report.short)) : "";
  if (!report.added)
    return void (await send(b, [b.m.reorderNothing, missing].filter(Boolean).join("\n")));
  await send(b, [b.m.reorderDone(report.added), missing].filter(Boolean).join("\n"));
  return showCart(b);
}

/** false — оплаченного заказа нет и разговор не ведётся с ботом: слово уходит дальше (консультанту, поиску). */
async function reorderLast(b: Bot): Promise<boolean> {
  const order = await lastPaidOrder(b.ctx, b.customer);
  if (!order) {
    // Одиночное «повторить» без заказов — подсказка только на явную фразу про заказ.
    await send(b, b.m.reorderNoPaid);
    return true;
  }
  await reorderFrom(b, order);
  return true;
}

/** Фото покупателя с подписью или без — консультанту по прайсу картинкой. */
async function pricelistPhoto(b: Bot, msg: TelegramMessage): Promise<boolean> {
  const { pricelistMode } = await import("@/core/consultant/pricelist/mode");
  if (!pricelistMode(b.ctx.tenant)) return false;
  const fileId = msg.photo![msg.photo!.length - 1]!.file_id;
  const file = await downloadTelegramFile(b.api, fileId);
  const { imageFromBytes } = await import("@/core/consultant/pricelist/images");
  const image = file ? imageFromBytes(file.bytes) : null;
  return consultantReply(b, msg.caption?.trim() ?? "", image ? [image] : []);
}

/**
 * ИИ-консультант на свободный текст: отвечает по профилю, базе знаний и
 * каталогу; при передаче менеджеру — уведомление продавцу и пауза, чтобы
 * дальше отвечал человек (в /admin/chat диалог помечается «вы в чате»).
 */
async function consultantReply(
  b: Bot,
  text: string,
  images?: import("@/core/consultant/pricelist/images").V2Image[],
): Promise<boolean> {
  const { consultantEnabled, isPaused, runConsultant } =
    await import("@/core/consultant/engine.server");
  const { pauseHours, pauseNoticeRu } = await import("@/core/consultant/pause");
  if (!(await consultantEnabled(b.ctx))) return false;
  if (isPaused(b.customer)) return true; // менеджер ведёт диалог — бот молчит
  await b.api.call("sendChatAction", { chat_id: b.chatId, action: "typing" });
  const r = await runConsultant(b.ctx, b.customer, text, {
    platform: "telegram",
    ...(images ? { images } : {}),
  });
  if (!r) return false;
  await b.api.call("sendMessage", { chat_id: b.chatId, text: r.reply });
  // Фото и видео товара (консультант по прайсу) — следом, по ссылке /api/img.
  for (const a of r.attachments ?? [])
    await b.api
      .call(a.kind === "video" ? "sendVideo" : "sendPhoto", {
        chat_id: b.chatId,
        [a.kind === "video" ? "video" : "photo"]: a.url,
      })
      .catch(() => null);
  if (b.ctx.tenant.modules.manager_chat) {
    const { recordMessage } = await import("@/core/chat/chat");
    await recordMessage(b.ctx, {
      telegramId: b.customer.telegramId,
      direction: "out",
      sender: "bot",
      text: r.reply,
      reason: makeReason({ source: "consultant", handoff: r.handoff ? true : undefined }),
    });
  }
  if (r.handoff) {
    if (b.ctx.tenant.modules.manager_chat) {
      const { connect } = await import("@/core/chat/chat");
      await connect(b.ctx, b.customer.telegramId).catch(() => {});
    }
    const { leadFromHandoff } = await import("@/core/pipeline/sources");
    await leadFromHandoff(b.ctx, b.customer, r.handoff);
    const who =
      [b.customer.firstName, b.customer.lastName].filter(Boolean).join(" ") ||
      (b.customer.username ? `@${b.customer.username}` : `id ${b.customer.telegramId}`);
    const lines = [
      r.handoff.kind === "lead"
        ? `📝 <b>Заявка от ИИ-консультанта</b> (${escapeHtml(r.handoff.reason)})`
        : `🙋 <b>Клиент ждёт менеджера</b> (${escapeHtml(r.handoff.reason)})`,
      `👤 ${escapeHtml(who)}${b.customer.username ? ` · @${escapeHtml(b.customer.username)}` : ""}`,
      r.handoff.customerName ? `Имя: ${escapeHtml(r.handoff.customerName)}` : "",
      r.handoff.customerContact ? `📞 ${escapeHtml(r.handoff.customerContact)}` : "",
      `📋 ${escapeHtml(r.handoff.summary)}`,
      "",
      `Ответьте клиенту в разделе «Чат» панели — консультант в этом диалоге ${pauseNoticeRu(pauseHours(b.ctx.tenant))}.`,
    ].filter((l) => l !== "");
    for (const chatId of await adminRecipients(b.ctx))
      await b.api.call("sendMessage", {
        chat_id: chatId,
        text: lines.join("\n"),
        parse_mode: "HTML",
      });
  }
  return true;
}

/** Отписка или возврат к рассылкам; ответ — одинаковый и при повторе. */
/**
 * Команда из меню бота (channels/telegram/commands) ведёт на тот же экран,
 * что кнопка главного меню; незаконченное оформление сбрасывается, как при
 * нажатии кнопки.
 */
async function botCommand(b: Bot, command: BotCommand) {
  if (command === "stop") return optOutReply(b, "unsubscribe");
  if (command === "language") {
    if (!b.ctx.tenant.modules.multi_language) return sendMain(b);
    await send(b, b.m.chooseLanguage, { reply_markup: { inline_keyboard: languageChoice() } });
    return;
  }
  if (b.customer.state.mode && b.customer.state.mode !== "idle")
    b.customer = await setState(b.ctx, b.customer, { ...b.customer.state, mode: "idle" });
  return menuAction(b, command === "orders" ? "myOrders" : command);
}

async function optOutReply(b: Bot, cmd: OptOutCommand) {
  await setOptOut(b.ctx, b.customer.userKey, cmd === "unsubscribe");
  await send(b, cmd === "unsubscribe" ? b.m.unsubscribed : b.m.resubscribed);
}

async function startFlow(b: Bot, payload = "") {
  // Откуда пришёл покупатель — первая ссылка /start, для карточки покупателя (core/customers/card).
  if (payload && !b.customer.state.first_source)
    b.customer = await setState(b.ctx, b.customer, {
      ...b.customer.state,
      first_source: payload.slice(0, 64),
    });
  if (payload.startsWith(REFERRAL_PREFIX)) {
    const gift = await registerReferral(
      b.ctx,
      b.customer.telegramId,
      payload.slice(REFERRAL_PREFIX.length),
    ).catch((e) => {
      // /start не должен молчать из-за сбоя реферала: продолжаем без подарка.
      console.error(`[telegram] реферал: ${String(e)}`);
      return null;
    });
    if (gift) await send(b, b.m.referralWelcome(gift.percent, gift.code));
    payload = "";
  }
  // Ссылка розыгрыша ?start=gw_<id> (модуль giveaways): участие в один шаг.
  if (payload.startsWith("gw_") && b.ctx.tenant.modules.giveaways) {
    const { giveawayEntry, giveawayIdFrom } = await import("./giveaway");
    const gid = giveawayIdFrom(payload);
    if (gid) return giveawayEntry(b.ctx, b.api, b.chatId, b.customer, b.locale, gid);
  }
  // Ссылка продавца ?start=bday: покупатель сам вводит день рождения (модуль funnel).
  if (payload === "bday" && b.ctx.tenant.modules.funnel) {
    b.customer = await setState(b.ctx, b.customer, {
      ...b.customer.state,
      mode: "awaiting_birthday",
    });
    return void (await send(b, b.m.birthdayAsk));
  }
  if (payload.startsWith(HANDOFF_PREFIX)) {
    const r = await claimHandoff(b.ctx, b.customer, payload.slice(HANDOFF_PREFIX.length));
    if (!b.customer.state.locale)
      await applyLocale(b, b.ctx.tenant.settings.default_locale ?? "ru");
    if (r === "ok" || r === "claimed") return showCart(b);
    await send(b, b.m.cartEmpty);
    return;
  }
  // Ссылка «Сообщить о поступлении» с сайта: товар без остатка — в лист ожидания, иначе карточка.
  const waitId = b.ctx.tenant.modules.waitlist ? parseWaitlistPayload(payload) : null;
  if (waitId) {
    if (!b.customer.state.locale)
      await applyLocale(b, b.ctx.tenant.settings.default_locale ?? "ru");
    const p = await getProduct(b.ctx, waitId);
    if (p && shouldJoinWaitlist(b.ctx.tenant.modules.stock, p)) {
      const { joinWaitlist } = await import("@/core/waitlist/waitlist");
      b.customer = await joinWaitlist(b.ctx, b.customer, p.id);
      return void (await send(b, b.m.waitlistJoined));
    }
    if (p) return sendProductCard(b, p);
    // Скрытый или удалённый товар: ни карточки, ни записи в лист ожидания.
    return void (await send(b, b.m.unavailable));
  }
  if (payload.startsWith("p_")) {
    if (!b.customer.state.locale)
      await applyLocale(b, b.ctx.tenant.settings.default_locale ?? "ru");
    const p = await getProduct(b.ctx, payload.slice(2));
    if (p) return sendProductCard(b, p);
    return void (await send(b, b.m.unavailable));
  }
  if (b.ctx.tenant.modules.multi_language) {
    await send(b, b.m.chooseLanguage, { reply_markup: { inline_keyboard: languageChoice() } });
    return;
  }
  await applyLocale(b, b.ctx.tenant.settings.default_locale ?? "ru");
}

async function applyLocale(b: Bot, locale: Locale) {
  b.customer = await setState(b.ctx, b.customer, { ...b.customer.state, locale, mode: "idle" });
  b.locale = locale;
  b.m = COPY[locale];
  const shopName = (await getSetting(b.ctx, "shop_name")) ?? b.ctx.tenant.name;
  await sendMain(b, welcomeHtml(b.ctx.tenant, shopName, locale));
}

async function menuAction(b: Bot, action: ReturnType<typeof menuActionFor>) {
  switch (action) {
    case "quiz":
      return b.ctx.tenant.modules.quiz ? quizAsk(b, 0, true) : showCategories(b, null, 0);
    case "catalog":
      return showCategories(b, null, 0);
    case "search":
      b.customer = await setState(b.ctx, b.customer, { ...b.customer.state, mode: "search" });
      await send(b, b.m.searchPrompt);
      return;
    case "cart":
      return showCart(b);
    case "myOrders":
      return showMyOrders(b);
    case "myCourses":
      return b.ctx.tenant.modules.courses ? showMyCourses(b) : showMyOrders(b);
    case "instruction": {
      const v = verticalDef(b.ctx.tenant.vertical).locales[b.locale];
      const caption =
        (await getSetting(b.ctx, "instruction_caption")) ??
        v.instructionDefaultCaption ??
        b.m.instructionDefault;
      await send(b, escapeHtml(caption));
      return;
    }
    case "information": {
      if (!b.ctx.tenant.modules.legal_docs) return sendMain(b);
      const base = `${storefrontBase(b.ctx.tenant, b.ctx.appUrl)}/legal`;
      const buttons: InlineButton[][] = [
        [
          { text: b.m.infoOfferBtn, url: `${base}/offer` },
          { text: b.m.infoPrivacyBtn, url: `${base}/privacy` },
        ],
        [
          { text: b.m.infoRequisitesBtn, url: `${base}/requisites` },
          { text: b.m.infoAboutBtn, url: `${base}/about` },
        ],
      ];
      const botName = b.ctx.tenant.settings.telegram?.username;
      if (b.ctx.tenant.modules.referral && botName)
        buttons.push([
          {
            text: b.m.inviteFriendBtn,
            url: `https://t.me/${botName}?start=${REFERRAL_PREFIX}${b.customer.telegramId}`,
          },
        ]);
      await send(b, b.m.infoText, { reply_markup: { inline_keyboard: buttons } });
      return;
    }
    case "invite": {
      const botName = b.ctx.tenant.settings.telegram?.username;
      if (!b.ctx.tenant.modules.referral || !botName) return sendMain(b);
      const link = `https://t.me/${botName}?start=${REFERRAL_PREFIX}${b.customer.telegramId}`;
      const stats = await referralStats(b.ctx, b.customer.telegramId);
      const codes = stats.codes
        .map((c) => `<code>${escapeHtml(c.code)}</code>${c.used ? ` — ${b.m.inviteCodeUsed}` : ""}`)
        .join("\n");
      await send(b, b.m.inviteScreen(link, stats.came, stats.bought, codes), {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: b.m.inviteShareBtn,
                url: `https://t.me/share/url?url=${encodeURIComponent(link)}`,
              },
            ],
          ],
        },
      });
      return;
    }
    case "myTickets":
      return b.ctx.tenant.modules.helpdesk ? showMyTickets(b) : sendMain(b);
    case "contact": {
      if (b.ctx.tenant.modules.helpdesk) {
        b.customer = await setState(b.ctx, b.customer, {
          ...b.customer.state,
          mode: "awaiting_ticket",
        });
        await send(b, b.m.ticketPrompt);
        return;
      }
      const link = await getSetting(b.ctx, "admin_contact_link");
      await send(b, link ? b.m.contactAuthor(escapeHtml(link)) : b.m.contactNotSet);
      return;
    }
  }
}

/** «Мои обращения»: свои номера и статусы; в открытое можно дописать. */
async function showMyTickets(b: Bot) {
  const { myTickets } = await import("@/core/helpdesk/mine");
  const { myTicketsText, DATE_LOCALE } = await import("./copy");
  const list = await myTickets(b.ctx, b.customer.telegramId);
  const text = myTicketsText(b.m, list, {
    html: true,
    date: (iso) =>
      new Date(iso).toLocaleDateString(DATE_LOCALE[b.locale] ?? "ru-RU", {
        day: "numeric",
        month: "short",
        timeZone: b.ctx.timezone,
      }),
  });
  await send(b, text, {
    ...(list.canAppend
      ? {
          reply_markup: {
            inline_keyboard: [[{ text: b.m.myTicketsAppendBtn, callback_data: "tkadd" }]],
          },
        }
      : {}),
  });
}

// ── каталог ───────────────────────────────────────────────────────────

async function backButton(b: Bot, parentId: string | null): Promise<InlineButton[] | null> {
  if (!parentId) return null;
  const up = await categoryParentId(b.ctx, parentId);
  return [{ text: b.m.back, callback_data: up ? `cat:${up}:0` : "cat:root:0" }];
}

async function showCategories(b: Bot, parentId: string | null, offset: number) {
  const [cats, products] = await Promise.all([
    listChildCategories(b.ctx, parentId),
    listProductsInCategory(b.ctx, parentId),
  ]);
  if (offset === 0 && cats.length > 0) {
    const rows: InlineButton[][] = cats.map((c) => [
      { text: categoryButtonLabel(c.name), callback_data: `cat:${c.id}:0` },
    ]);
    const back = await backButton(b, parentId);
    if (back) rows.push(back);
    await send(b, parentId ? b.m.subcategories : b.m.catalogHeader, {
      reply_markup: { inline_keyboard: rows },
    });
  }
  if (products.length === 0 && cats.length === 0) {
    if (offset === 0) {
      const back = await backButton(b, parentId);
      await send(b, b.m.emptyHere, back ? { reply_markup: { inline_keyboard: [back] } } : {});
    }
    return;
  }
  for (const p of products.slice(offset, offset + PAGE)) await sendProductCard(b, p);
  const nav: InlineButton[][] = [];
  if (offset + PAGE < products.length) {
    nav.push([{ text: b.m.showMore, callback_data: `cat:${parentId ?? "root"}:${offset + PAGE}` }]);
  }
  if (parentId && (cats.length === 0 || offset > 0)) {
    const back = await backButton(b, parentId);
    if (back) nav.push([{ ...back[0]!, text: b.m.backToCategories }]);
  }
  if (nav.length) await send(b, b.m.navigation, { reply_markup: { inline_keyboard: nav } });
}

/** Квиз: вопрос номер q; ответы копятся в state.quiz_tags до результата. */
async function quizAsk(b: Bot, q: number, fresh = false): Promise<void> {
  const { loadQuiz } = await import("@/core/quiz/quiz");
  const quiz = await loadQuiz(b.ctx);
  if (!quiz.questions.length) {
    await send(b, b.m.quizNotReady, {
      reply_markup: { inline_keyboard: [[{ text: b.m.catalog, callback_data: "cat:root" }]] },
    });
    return;
  }
  if (fresh) {
    b.customer = await setState(b.ctx, b.customer, { ...b.customer.state, quiz_tags: [] });
    if (quiz.intro) await send(b, escapeHtml(quiz.intro));
  }
  const question = quiz.questions[q];
  if (!question) return quizFinish(b);
  await send(b, `<b>${q + 1}/${quiz.questions.length}.</b> ${escapeHtml(question.text)}`, {
    reply_markup: {
      inline_keyboard: question.options.map((o, i) => [
        { text: o.label, callback_data: `quiz:${q}:${i}` },
      ]),
    },
  });
}

async function quizFinish(b: Bot): Promise<void> {
  const { quizResult } = await import("@/core/quiz/quiz");
  const tags = Array.isArray(b.customer.state.quiz_tags)
    ? (b.customer.state.quiz_tags as string[])
    : [];
  const found = await quizResult(b.ctx, tags);
  // Итог подбора для карточки на «Рассылках»: прошли до конца, что бы ни нашлось.
  const { recordEngage } = await import("@/core/automsg/engage");
  await recordEngage(b.ctx, "quiz_done", b.customer.telegramId);
  if (!found.length) {
    await send(b, b.m.quizNothing, {
      reply_markup: { inline_keyboard: [[{ text: b.m.catalog, callback_data: "cat:root" }]] },
    });
    return;
  }
  await send(b, b.m.quizResult, {
    reply_markup: {
      inline_keyboard: found.map((p) => [
        { text: p.name.slice(0, 60), callback_data: `prod:${p.id}` },
      ]),
    },
  });
}

async function sendProductCard(b: Bot, p: Product) {
  const {
    caption,
    keyboard: base,
    photo,
  } = await productCard(b.ctx, p, b.locale, b.customer.state.country_code ?? null);
  // Пример цифрового товара (core/catalog/preview) — кнопкой под карточкой.
  const { loadPreview } = await import("@/core/catalog/preview");
  const hasPreview =
    p.fulfillment_kind !== "physical" && (await loadPreview(b.ctx, p.id)).length > 0;
  const keyboard = hasPreview
    ? {
        ...base,
        inline_keyboard: [
          ...(base.inline_keyboard ?? []),
          [{ text: b.m.previewBtn, callback_data: `prev:${p.id}` }],
        ],
      }
    : base;
  if (!photo) {
    await send(b, caption, { reply_markup: keyboard });
  } else {
    const res = await b.api.call("sendPhoto", {
      chat_id: b.chatId,
      photo,
      caption: caption.slice(0, 1024),
      parse_mode: "HTML",
      reply_markup: keyboard,
    });
    if (!res.ok) await send(b, caption, { reply_markup: keyboard });
  }
}

/**
 * Поиск по каталогу страницами по PAGE. Запрос запоминается в
 * state.last_search: в callback `searchmore:<сдвиг>` он не помещается
 * (64 байта), формат общий с v1 — её кнопки в старых чатах тоже работают.
 */
async function showSearch(b: Bot, query: string, offset = 0) {
  const found = await searchProductsTolerant(b.ctx, query);
  if (b.customer.state.last_search !== query)
    b.customer = await setState(b.ctx, b.customer, { ...b.customer.state, last_search: query });
  if (found.length > 0) {
    const page = searchPage(found.length, offset, PAGE);
    if (page.from === 0) await send(b, b.m.searchResults(escapeHtml(query), found.length));
    for (const p of found.slice(page.from, page.to)) await sendProductCard(b, p);
    if (page.next !== null)
      await send(b, b.m.searchShown(page.to, found.length), {
        reply_markup: {
          inline_keyboard: [[{ text: b.m.showMore, callback_data: `searchmore:${page.next}` }]],
        },
      });
    return;
  }
  // Следующая страница без результатов (каталог изменился) — не звать LLM повторно.
  if (offset > 0) {
    await send(b, b.m.searchNothing(escapeHtml(query)));
    return;
  }
  const smart = await smartSearchFallback(b, query);
  if (smart.length === 0) {
    await send(b, b.m.searchNothing(escapeHtml(query)));
    return;
  }
  await send(b, b.m.smartSearchResults(escapeHtml(query), smart.length));
  for (const p of smart.slice(0, PAGE)) await sendProductCard(b, p);
}

/** Сколько результатов свободного поиска показываем кнопками. */
export const FREE_SEARCH_MAX = 8;

/** Свободный текст — запрос поиска: не команда, не пустой, не длиннее поиска каталога. */
export function isFreeTextQuery(text: string): boolean {
  const t = text.trim();
  return t.length >= 2 && t.length <= 80 && !t.startsWith("/");
}

/**
 * Любой текст вне шага — поиск по названию, ключевым словам и описанию (с
 * опечаткой в одну букву): до FREE_SEARCH_MAX товаров кнопками, иначе «не нашёл»
 * с кнопкой «Каталог». Запрос запоминается для «Показать ещё» (searchmore).
 */
async function freeTextSearch(b: Bot, text: string) {
  const query = text.trim();
  const found = await searchProductsTolerant(b.ctx, query, FREE_SEARCH_MAX + 1);
  if (found.length === 0) {
    await send(b, b.m.searchNothing(escapeHtml(query)), {
      reply_markup: { inline_keyboard: [[{ text: b.m.catalog, callback_data: "cat:root" }]] },
    });
    return;
  }
  if (b.customer.state.last_search !== query)
    b.customer = await setState(b.ctx, b.customer, { ...b.customer.state, last_search: query });
  const shown = found.slice(0, FREE_SEARCH_MAX);
  const rows = shown.map((p) => [{ text: p.name.slice(0, 60), callback_data: `prod:${p.id}` }]);
  if (found.length > FREE_SEARCH_MAX)
    rows.push([{ text: b.m.showMore, callback_data: `searchmore:${FREE_SEARCH_MAX}` }]);
  await send(b, b.m.searchResults(escapeHtml(query), shown.length), {
    reply_markup: { inline_keyboard: rows },
  });
}

/** Умный поиск (LLM) — только когда обычный ничего не нашёл и продавец его включил. */
async function smartSearchFallback(b: Bot, query: string): Promise<Product[]> {
  const { smartSearchEnabled, consumeQuota, smartSearchProductIds } =
    await import("@/core/search/smart.server");
  if (!(await smartSearchEnabled(b.ctx))) return [];
  if (!(await consumeQuota(b.ctx, b.customer))) return [];
  const ids = await smartSearchProductIds(b.ctx, query);
  if (!ids?.length) return [];
  const { data, error: readErr } = await b.ctx.db
    .from("products")
    .select(PRODUCT_SELECT)
    .in("id", ids.slice(0, PAGE))
    .eq("is_active", true);
  if (readErr) throw serverFailure(`[telegram] товары не прочитаны: ${readErr.message}`);
  const byId = new Map(((data ?? []) as unknown as Product[]).map((p) => [p.id, p]));
  return ids.map((id) => byId.get(id)).filter((p): p is Product => Boolean(p));
}

// ── корзина и оформление ──────────────────────────────────────────────

/** Уровень лояльности и «до следующего»; сбой чтения — без строки, а не без корзины. */
async function tierLine(b: Bot): Promise<string> {
  try {
    const cur = await shopCurrency(b.ctx);
    const status = await customerTierStatus(b.ctx, b.customer.telegramId, cur);
    if (!status?.tier) return "";
    const toNext = status.next
      ? b.m.loyaltyTierNext(
          formatMoney(status.next.remaining, cur),
          escapeHtml(status.next.tier.name),
        )
      : null;
    return b.m.loyaltyTierLine(escapeHtml(status.tier.name), status.tier.percent, toNext);
  } catch (e) {
    console.error(`[telegram] уровень лояльности: ${String(e)}`);
    return "";
  }
}

async function showCart(b: Bot) {
  const items = await listCart(b.ctx, b.customer);
  if (items.length === 0) {
    await send(b, b.m.cartEmpty);
    return;
  }
  const st = b.customer.state;
  const priced = await priceCart(b.ctx, items, st.country_code ?? null);
  const sum = await cartSummary(b.ctx, b.customer, priced, {
    promoCode: st.promo_code,
    usePoints: st.use_points,
    giftCode: st.gift_certificate_code,
  });
  const mod = b.ctx.tenant.modules;
  let text = b.m.cartHeader;
  const buttons: InlineButton[][] = [];
  const { preordersFor, activePreorder } = await import("@/core/preorder/preorder");
  const preorders = await preordersFor(
    b.ctx,
    priced.lines.map((l) => l.item.products!.id),
  );
  for (const line of priced.lines) {
    text += `• ${escapeHtml(line.name)} × ${line.item.quantity} — ${formatMoney(line.line, priced.currency)}\n`;
    const pre = activePreorder(
      b.ctx,
      line.item.products!,
      preorders.get(line.item.products!.id),
      Number(line.item.quantity),
    );
    if (pre) text += b.m.preorderCartNote(pre.from);
    buttons.push([{ text: b.m.removeItem(line.name), callback_data: `rem:${line.item.id}` }]);
  }
  if (sum.promo) text += b.m.discountLine(formatMoney(sum.promo.discount, sum.currency));
  if (sum.points.balance > 0) {
    text += b.m.pointsBalanceLine(sum.points.balance);
    if (sum.points.discount > 0)
      text += b.m.pointsDiscountLine(formatMoney(sum.points.discount, sum.currency));
    if (sum.points.fx)
      text += b.m.pointsFxLine(sum.points.spent, formatMoney(sum.points.discount, sum.currency));
  }
  if (mod.loyalty) text += await tierLine(b);
  if (sum.gift)
    text += b.m.giftCertificateDiscountLine(formatMoney(sum.gift.discount, sum.currency));
  if (sum.discountFx) text += `${b.m.discountFx}\n`;
  if (mod.bundles && st.gift_on)
    text += b.m.giftCartLine(
      escapeHtml(st.gift_recipient ?? ""),
      escapeHtml(st.gift_message ?? ""),
    );
  const { giftWrapForCart } = await import("@/core/orders/gift-wrap");
  const { giftAskOn } = await import("@/core/orders/gift");
  const wrapFee =
    mod.bundles && st.gift_on
      ? await giftWrapForCart(b.ctx, { kind: priced.kind, currency: sum.currency })
      : 0;
  if (wrapFee > 0 && st.gift_wrap) text += b.m.giftWrapLine(formatMoney(wrapFee, sum.currency));
  text += b.m.total(
    formatMoney(sum.total + (wrapFee > 0 && st.gift_wrap ? wrapFee : 0), sum.currency),
  );
  const below = await belowMinimum(b.ctx, priced);
  if (below) text += `${minOrderText(b.m, below)}\n`;
  const freeStatus = await (await freeDeliveryView(b.ctx, b.customer))?.forZone(null);
  if (freeStatus) text += freeDeliveryText(b.m, freeStatus);
  buttons.push([
    { text: b.m.checkoutBtn, callback_data: "checkout" },
    { text: b.m.clearBtn, callback_data: "clear" },
  ]);
  if (mod.coupons) {
    buttons.push([
      sum.promo
        ? { text: b.m.removePromoBtn, callback_data: "promo:clear" }
        : { text: b.m.promoCodeBtn, callback_data: "promo:enter" },
    ]);
  }
  if (mod.loyalty && sum.points.balance > 0) {
    buttons.push([
      sum.points.used
        ? { text: b.m.removePointsBtn, callback_data: "points:clear" }
        : { text: b.m.usePointsBtn, callback_data: "points:use" },
    ]);
  }
  if (mod.gift_certificates) {
    buttons.push([
      sum.gift
        ? { text: b.m.removeGiftCertificateBtn, callback_data: "giftcert:clear" }
        : { text: b.m.giftCertificateBtn, callback_data: "giftcert:enter" },
    ]);
  }
  // Кнопка подарка — только если продавец включил «Предлагать оформить заказ подарком».
  if (mod.bundles && (await giftAskOn(b.ctx))) {
    buttons.push([
      st.gift_on
        ? { text: b.m.removeGiftBtn, callback_data: "gift:clear" }
        : { text: b.m.giftBtn, callback_data: "gift:enter" },
    ]);
  }
  if (wrapFee > 0) {
    buttons.push([
      st.gift_wrap
        ? { text: b.m.removeGiftWrapBtn, callback_data: "gift:unwrap" }
        : { text: b.m.giftWrapBtn(formatMoney(wrapFee, sum.currency)), callback_data: "gift:wrap" },
    ]);
  }
  if (mod.upsell) {
    const { upsellFor } = await import("@/core/upsell/upsell");
    const offers = await upsellFor(
      b.ctx,
      priced.lines.map((l) => l.item.products?.id).filter((x): x is string => Boolean(x)),
    );
    if (offers.length) {
      text += `\n\n${b.m.upsellHeader}`;
      for (const o of offers) {
        const money = await resolvePrice(b.ctx, o, st.country_code ?? null);
        buttons.push([
          {
            text: `➕ ${o.name} — ${formatMoney(money.amount, money.currency)}`.slice(0, 64),
            // Третья часть «u» — кнопка из «С этим берут»: добавление идёт в итоги допродажи.
            callback_data: `add:${o.id}::u`,
          },
        ]);
      }
    }
  }
  await send(b, text.slice(0, 4096), { reply_markup: { inline_keyboard: buttons } });
}

async function askCountry(b: Bot, forCheckout: boolean) {
  const methods = await listActivePaymentMethods(b.ctx);
  if (methods.length === 0) {
    await send(b, b.m.paymentNotConfigured);
    return;
  }
  const prefix = forCheckout ? "country:" : "setcountry:";
  await send(b, b.m.chooseCountry, {
    reply_markup: {
      inline_keyboard: methods.map((m) => [
        { text: m.country_name, callback_data: `${prefix}${m.country_code}` },
      ]),
    },
  });
}

async function startCheckout(b: Bot) {
  if ((await cartCount(b.ctx, b.customer)) === 0) {
    await send(b, b.m.cartEmpty);
    return;
  }
  return continueCheckout(b);
}

async function continueCheckout(b: Bot) {
  if (!b.customer.contactPhone) {
    b.customer = await setState(b.ctx, b.customer, {
      ...b.customer.state,
      mode: "awaiting_contact",
    });
    await send(b, b.m.phonePromptHtml, {
      reply_markup: {
        keyboard: [[{ text: b.m.shareContactBtn, request_contact: true }]],
        resize_keyboard: true,
        one_time_keyboard: true,
      },
    });
    return;
  }
  if (!b.customer.state.country_code) return askCountry(b, true);
  return proceedToFulfillmentOrPlace(b, b.customer.state.country_code);
}

/** Физическая корзина: способ получения → дата → зона и адрес → пожелания → заказ. */
async function proceedToFulfillmentOrPlace(b: Bot, countryCode: string) {
  const items = await listCart(b.ctx, b.customer);
  const physical = items.some((i) => i.products?.fulfillment_kind === "physical");
  const {
    checkout_fulfillment_type: _t,
    checkout_fulfillment_at: _a,
    checkout_delivery_zone_id: _z,
    checkout_delivery_zone_name: _zn,
    checkout_delivery_fee: _zf,
    checkout_fulfillment_address: _ad,
    checkout_fulfillment_note: _n,
    ...clean
  } = b.customer.state;
  if (!physical) {
    b.customer = await setState(b.ctx, b.customer, clean);
    return proceedToLanguageOrPlace(b, countryCode);
  }
  const fs = await fulfillmentSettings(b.ctx);
  if (fs.pickup && fs.delivery) {
    b.customer = await setState(b.ctx, b.customer, { ...clean, mode: "awaiting_fulfillment_type" });
    await send(b, b.m.fulfillmentTypePrompt, {
      reply_markup: {
        inline_keyboard: [
          [{ text: b.m.fulfillmentTypePickupBtn, callback_data: "fulfilltype:pickup" }],
          [{ text: b.m.fulfillmentTypeDeliveryBtn, callback_data: "fulfilltype:delivery" }],
        ],
      },
    });
    return;
  }
  b.customer = await setState(b.ctx, b.customer, {
    ...clean,
    checkout_fulfillment_type: fs.delivery ? "delivery" : "pickup",
  });
  return askFulfillmentDate(b);
}

async function askFulfillmentDate(b: Bot) {
  const rules = await closedRules(b.ctx);
  const minIso = await earliestFulfillmentDate(b.ctx, b.customer, rules);
  b.customer = await setState(b.ctx, b.customer, {
    ...b.customer.state,
    mode: "awaiting_fulfillment_date",
    checkout_min_fulfillment_date: minIso,
  });
  await send(
    b,
    b.m.fulfillmentDatePrompt(isoToDisplay(minIso)) +
      (hasClosedDays(rules)
        ? `\n${b.m.fulfillmentClosedNote(describeClosed(rules, b.locale))}`
        : ""),
  );
}

/** Ответ покупателя на фото готового заказа: в таймлайн и продавцу (core/orders/approval). */
async function answerApproval(
  b: Bot,
  orderId: number,
  answer: { ok: true } | { ok: false; text: string },
) {
  const { recordApprovalAnswer } = await import("@/core/orders/approval");
  const recorded = await recordApprovalAnswer(b.ctx, orderId, answer);
  if (recorded) {
    const order = await getOrder(b.ctx, orderId);
    const no = order ? displayNo(order) : orderId;
    await notifyAdminsHtml(
      b.ctx,
      answer.ok
        ? `✅ Покупатель одобрил фото заказа #${no}`
        : `✏️ <b>Правки к заказу #${no}</b>\n\n${escapeHtml(answer.text.slice(0, 1000))}`,
      { kind: "question", orderId },
    ).catch(() => 0);
  }
  await send(b, answer.ok ? b.m.approvalThanks : b.m.approvalChangesSent);
}

async function afterDate(b: Bot) {
  // Слоты магазина (core/fulfillment/slots): после даты — время, слот едет в дате.
  const at = b.customer.state.checkout_fulfillment_at ?? "";
  if (at && !at.includes("T")) {
    const { fulfillmentSlots } = await import("@/core/fulfillment/slots");
    const slots = await fulfillmentSlots(b.ctx);
    if (slots.length) {
      const free = await freeSlotsOnDate(b.ctx, at);
      // Все слоты дня разобрали, пока покупатель выбирал: назад к дате.
      if (free.length === 0) {
        await send(b, b.m.fulfillmentDateFull(null));
        return askFulfillmentDate(b);
      }
      b.customer = await setState(b.ctx, b.customer, {
        ...b.customer.state,
        mode: "awaiting_fulfillment_slot",
      });
      return void (await send(b, b.m.fulfillmentSlotPrompt, {
        reply_markup: {
          // Номер кнопки — место слота в списке магазина, а не в списке свободных.
          inline_keyboard: free.map((s) => [
            { text: s, callback_data: `slot:${slots.indexOf(s)}` },
          ]),
        },
      }));
    }
  }
  if (b.customer.state.checkout_fulfillment_type === "delivery") return askZoneOrAddress(b);
  return askNote(b);
}

async function askZoneOrAddress(b: Bot) {
  const zones = await activeDeliveryZones(b.ctx);
  if (zones.length === 0) {
    b.customer = await setState(b.ctx, b.customer, {
      ...b.customer.state,
      mode: "awaiting_address",
    });
    return void (await send(b, b.m.addressPrompt));
  }
  b.customer = await setState(b.ctx, b.customer, {
    ...b.customer.state,
    mode: "awaiting_delivery_zone",
  });
  const view = await freeDeliveryView(b.ctx, b.customer);
  const buttons = await Promise.all(
    zones.map(async (z) => {
      const fee = await zoneFee(b.ctx, z.price, b.customer.state.country_code);
      const free = (await view?.forZone(z.id))?.free ?? false;
      return [
        {
          text: `${z.name} (${free ? b.m.freeWord : `+${formatMoney(fee.amount, fee.currency)}`})`,
          callback_data: `zone:${z.id}`,
        },
      ];
    }),
  );
  await send(b, b.m.deliveryZonePrompt, { reply_markup: { inline_keyboard: buttons } });
}

async function pickZone(b: Bot, zoneId: string) {
  const zone = (await activeDeliveryZones(b.ctx)).find((z) => z.id === zoneId);
  if (!zone) return askZoneOrAddress(b);
  const fee = await zoneFee(b.ctx, zone.price, b.customer.state.country_code);
  b.customer = await setState(b.ctx, b.customer, {
    ...b.customer.state,
    checkout_delivery_zone_id: zone.id,
    checkout_delivery_zone_name: zone.name,
    checkout_delivery_fee: fee.amount,
    mode: "awaiting_address",
  });
  await send(b, b.m.addressPrompt);
}

async function askNote(b: Bot) {
  b.customer = await setState(b.ctx, b.customer, {
    ...b.customer.state,
    mode: "awaiting_fulfillment_note",
  });
  await send(b, b.m.fulfillmentNotePrompt, {
    reply_markup: {
      inline_keyboard: [[{ text: b.m.fulfillmentNoteSkipBtn, callback_data: "fulfillnote:skip" }]],
    },
  });
}

async function finishAfterNote(b: Bot, note: string | null) {
  b.customer = await setState(b.ctx, b.customer, {
    ...b.customer.state,
    checkout_fulfillment_note: note ?? undefined,
    mode: "idle",
  });
  const cc = b.customer.state.country_code;
  if (!cc) return askCountry(b, true);
  return finishCheckout(b, cc);
}

/**
 * Между страной и оформлением: модуль multi_language с настройкой «спросить
 * до оформления» и больше одного языка в корзине — выбор языка (или «все
 * языки ×N»); иначе сразу заказ.
 */
async function proceedToLanguageOrPlace(b: Bot, countryCode: string) {
  const { askDeliveryLangBeforeOrder, cartLanguageChoices } = await import("@/core/cart/languages");
  if (await askDeliveryLangBeforeOrder(b.ctx)) {
    const langs = await cartLanguageChoices(b.ctx, b.customer);
    if (langs.length > 1) {
      b.customer = await setState(b.ctx, b.customer, {
        ...b.customer.state,
        mode: "awaiting_delivery_lang",
        delivery_lang: undefined,
      });
      await send(b, b.m.chooseDeliveryLanguage, {
        reply_markup: {
          inline_keyboard: [
            ...langs.map((l) => [
              { text: `${localeFlags[l]} ${localeNames[l]}`, callback_data: `checkoutlang:${l}` },
            ]),
            [{ text: b.m.allLanguagesBtn(langs.length), callback_data: "checkoutlang:all" }],
          ],
        },
      });
      return;
    }
  }
  return finishCheckout(b, countryCode);
}

async function finishCheckout(b: Bot, countryCode: string) {
  const st = b.customer.state;
  const result = await placeOrder(b.ctx, b.customer, countryCode, {
    promoCode: st.promo_code,
    usePoints: st.use_points,
    giftCode: st.gift_certificate_code,
    gift: st.gift_on ? { recipient: st.gift_recipient, message: st.gift_message } : null,
    giftWrap: Boolean(st.gift_on && st.gift_wrap),
    deliveryLang: isDeliveryLangChoice(st.delivery_lang) ? st.delivery_lang : null,
    fulfillment: st.checkout_fulfillment_type
      ? {
          type: st.checkout_fulfillment_type,
          at: st.checkout_fulfillment_at ?? null,
          address: st.checkout_fulfillment_address ?? null,
          note: st.checkout_fulfillment_note ?? null,
          zone: st.checkout_delivery_zone_id
            ? {
                id: st.checkout_delivery_zone_id,
                name: st.checkout_delivery_zone_name ?? "",
                fee: st.checkout_delivery_fee ?? 0,
              }
            : null,
        }
      : null,
  });
  if (!result.ok) {
    switch (result.reason) {
      case "busy":
        return void (await send(b, b.m.checkoutBusy));
      case "empty_cart":
        return void (await send(b, b.m.cartEmpty));
      case "country_unavailable":
        await send(b, b.m.countryNoLongerAvailable);
        return askCountry(b, true);
      case "promo_invalid":
      case "promo_used": {
        const { promo_code: _pc, ...rest } = st;
        b.customer = await setState(b.ctx, b.customer, rest);
        return void (await send(
          b,
          result.reason === "promo_used" ? b.m.promoCodeUsed : b.m.promoCodeInvalid,
        ));
      }
      case "discount_fx":
        return void (await send(b, b.m.discountFx));
      case "mixed_currency":
        return void (await send(b, b.m.mixedCurrency));
      case "gift_invalid": {
        const { gift_certificate_code: _gc, ...rest } = st;
        b.customer = await setState(b.ctx, b.customer, rest);
        return void (await send(b, b.m.giftCertificateInvalid));
      }
      case "gift_wrap_unavailable": {
        const { gift_wrap: _gw, ...rest } = st;
        b.customer = await setState(b.ctx, b.customer, rest);
        return void (await send(b, b.m.giftWrapUnavailable));
      }
      case "out_of_stock":
        return void (await send(b, b.m.outOfStockAtCheckout));
      case "day_full":
        await send(b, b.m.orderDayTaken);
        return askFulfillmentDate(b);
      case "slot_taken": {
        await send(b, b.m.orderSlotTaken);
        // Дата та же, время выбрать заново.
        const { checkout_fulfillment_at: at, ...keep } = b.customer.state;
        b.customer = await setState(b.ctx, b.customer, {
          ...keep,
          checkout_fulfillment_at: at?.slice(0, 10),
        });
        return afterDate(b);
      }
      case "below_min":
        return void (await send(b, minOrderText(b.m, result)));
      default:
        return void (await send(b, b.m.orderCreateFailed));
    }
  }
  const { order, method } = result;
  const no = displayNo(order);
  // «Спасибо за заказ» — только свой текст продавца (core/bot-texts), перед платёжными реквизитами.
  const thanks = orderThanksHtml(b.ctx.tenant, b.locale, no);
  if (thanks !== null) await send(b, thanks);
  // Промокод, баллы и сертификат — одноразовые: снимаем из состояния, чтобы
  // не прилипли к следующему заказу.
  const {
    placing_order: _p,
    promo_code: _promo,
    use_points: _up,
    gift_certificate_code: _gift,
    gift_on: _go,
    gift_recipient: _gre,
    gift_message: _gme,
    gift_wrap: _gwr,
    gift_asked: _gas,
    gift_reask: _grk,
    checkout_fulfillment_type: _ft,
    checkout_fulfillment_at: _fa,
    checkout_min_fulfillment_date: _fm,
    checkout_delivery_zone_id: _fz,
    checkout_delivery_zone_name: _fzn,
    checkout_delivery_fee: _ff,
    checkout_fulfillment_address: _fad,
    checkout_fulfillment_note: _fn,
    delivery_lang: _dl,
    ...rest
  } = b.customer.state;
  // Сертификат больше заказа — код на остаток сразу, до реквизитов.
  if (result.giftRest)
    await send(
      b,
      b.m.giftRestIssued(
        escapeHtml(result.giftRest.code),
        formatMoney(result.giftRest.amount, result.giftRest.currency),
      ),
    );
  const physical = order.fulfillment_kind === "physical";
  if (physical && result.amountDue <= 0 && !result.zeroTotal) {
    // Оплата при получении: заказ сразу в работе.
    await b.ctx.db
      .from("orders")
      .update({ status: "accepted" })
      .eq("id", order.id)
      .eq("status", "awaiting_payment");
    b.customer = await setState(b.ctx, b.customer, { ...rest, mode: "idle" });
    await send(b, b.m.orderAcceptedOnReceipt(no, formatMoney(order.total, order.currency)), {
      reply_markup: mainMenu(b),
    });
    await notifyAdminNewOrder(b.ctx, b.api, order, null);
    return;
  }
  if (result.zeroTotal) {
    b.customer = await setState(b.ctx, b.customer, { ...rest, mode: "idle" });
    await send(b, b.m.orderPaidByDiscounts(no), { reply_markup: mainMenu(b) });
    if (order.fulfillment_kind === "physical") {
      await b.ctx.db
        .from("orders")
        .update({ status: "accepted" })
        .eq("id", order.id)
        .eq("status", "awaiting_payment");
    } else {
      const r = await deliverOrder(b.ctx, order.id, telegramMaterialSender(b.api, b.chatId, b.m), {
        lang: b.locale,
        ask: telegramLanguageAsker(b.api, b.chatId, b.m),
      });
      if (r.failed === 0 && r.pending === 0) await send(b, b.m.orderDelivered(no));
      if (r.failed > 0) await notifyDeliveryFailure(b.ctx, order, r);
      if (r.pointsEarned > 0) await send(b, b.m.pointsEarned(r.pointsEarned));
      await notifyReferral(b.ctx, b.api, r.referral);
    }
    await notifyAdminNewOrder(b.ctx, b.api, order, null);
    return;
  }
  b.customer = await setState(b.ctx, b.customer, {
    ...rest,
    mode: "awaiting_proof",
    pending_order_id: order.id,
    pending_display_no: no,
  });
  const due = result.amountDue;
  const rk = await robokassaFor(b.ctx, order.currency);
  const { starsForOrder } = await import("@/core/payments/stars");
  const stars = await starsForOrder(b.ctx, due, order.currency);
  const { nowpaymentsFor } = await import("@/core/payments/payment");
  const crypto = await nowpaymentsFor(b.ctx);
  const { stripeFor } = await import("@/core/payments/payment");
  const stripe = await stripeFor(b.ctx);
  if (rk.ready || stars || crypto.ready || stripe.ready) {
    b.customer = await setState(b.ctx, b.customer, {
      ...rest,
      mode: "choose_pay",
      pending_order_id: order.id,
      pending_display_no: no,
    });
    await send(
      b,
      `${b.m.manualTitleNew(no)}\n\n${b.m.amountToPay(formatMoney(due, order.currency))}${await consentLine(b)}\n\n${b.m.choosePayMethod}`,
      {
        reply_markup: {
          inline_keyboard: [
            ...(rk.ready
              ? [[{ text: b.m.payViaRobokassaBtn, callback_data: `pay:rk:${order.id}` }]]
              : []),
            ...(stars
              ? [[{ text: b.m.payViaStarsBtn(stars), callback_data: `pay:stars:${order.id}` }]]
              : []),
            ...(crypto.ready
              ? [[{ text: b.m.payViaCryptoBtn, callback_data: `pay:crypto:${order.id}` }]]
              : []),
            ...(stripe.ready
              ? [[{ text: b.m.payViaStripeBtn, callback_data: `pay:stripe:${order.id}` }]]
              : []),
            [{ text: b.m.payManualBtn, callback_data: `pay:manual:${order.id}` }],
          ],
        },
      },
    );
    return;
  }
  const depositLine =
    physical && due < Number(order.total)
      ? `${b.m.depositLine(formatMoney(due, order.currency), formatMoney(order.total, order.currency))}\n\n`
      : "";
  await sendManualInstructions(b, {
    no,
    due,
    total: Number(order.total),
    currency: order.currency,
    instructions: method.instructions,
    qr: method.qr_code_path,
    physical,
    depositLine,
  });
}

/**
 * Оплата — акцепт оферты: строка со ссылками на опубликованные документы
 * (модуль legal_docs, адрес витрины). Нет документов — пусто.
 */
async function consentLine(b: Bot): Promise<string> {
  const { legalConsentNeeded } = await import("@/core/storefront/consent");
  const c = await legalConsentNeeded(b.ctx);
  if ((!c.offer && !c.privacy) || !b.ctx.tenant.settings.slug) return "";
  const base = `${storefrontBase(b.ctx.tenant, b.ctx.appUrl)}/legal`;
  return `\n\n${b.m.payConsent(c.offer ? `${base}/offer` : null, c.privacy ? `${base}/privacy` : null)}`;
}

async function sendManualInstructions(
  b: Bot,
  p: {
    no: number;
    due: number;
    total: number;
    currency: string;
    instructions: string | null;
    qr: string | null;
    physical: boolean;
    depositLine: string;
  },
) {
  const text =
    `${b.m.manualTitleNew(p.no)}\n\n${b.m.amountToPay(formatMoney(p.due, p.currency))}${await consentLine(b)}\n${p.depositLine}\n` +
    `${escapeHtml(p.instructions || b.m.defaultInstructions)}\n\n${p.physical ? b.m.afterProofPhysical : b.m.afterProofManual}`;
  if (p.qr && text.length <= 1024) {
    const r = await b.api.call("sendPhoto", {
      chat_id: b.chatId,
      photo: imageUrl(b.ctx, p.qr),
      caption: text,
      parse_mode: "HTML",
    });
    if (r.ok) return;
  }
  await send(b, text);
  if (p.qr) await b.api.call("sendPhoto", { chat_id: b.chatId, photo: imageUrl(b.ctx, p.qr) });
}

/** Оплата картой подтверждена шлюзом: выдать цифровой заказ, сообщить покупателю и продавцу. */
/** Сумма заказа к оплате сейчас — в звёздах; null — Stars недоступны. */
async function starsDue(
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
async function handlePreCheckout(
  ctx: TenantContext,
  api: TelegramApi,
  q: import("./types").TelegramPreCheckoutQuery,
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
async function handleStarsPaid(
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

async function receiveProof(b: Bot, msg: TelegramMessage, orderId: number) {
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
  const { receiptOcrAutoEnabled } = await import("@/core/receipts/verify.server");
  if (res.order.fulfillment_kind !== "physical" && (await receiptOcrAutoEnabled(b.ctx))) {
    const { verifyCustomerReceipt } = await import("@/core/receipts/verify.server");
    const { isRetryReason } = await import("@/core/receipts/pure");
    const checked = await verifyCustomerReceipt(b.ctx, b.customer, {
      bytes: file.bytes,
      mime: file.mime,
      expectedAmount: Number(res.order.total),
      currency: res.order.currency,
      orderId,
      recipientCountry: res.order.country_code,
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

  b.customer = await setState(b.ctx, b.customer, { ...b.customer.state, mode: "idle" });
  await send(b, b.m.proofReceived(no), { reply_markup: mainMenu(b) });
  await notifyAdminNewOrder(b.ctx, b.api, res.order, proof);
}

/**
 * Владелец отвечает на счёт оператора фото или файлом — тем же жестом, что
 * покупатель с чеком по заказу. Только когда у владельца есть открытый счёт
 * и нет своего заказа, ждущего чек (иначе тест собственного чекаута попал бы
 * сюда). Возвращает true, если сообщение обработано.
 */
async function ownerInvoiceProof(
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

async function downloadTelegramFile(
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

/** Фото к отзыву (core/reviews/photos): тип и размер проверяются по файлу. */
async function receiveReviewPhoto(b: Bot, msg: TelegramMessage, productId: string) {
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

async function askRating(b: Bot, productId: string, name: string) {
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
function notifyReferral(
  ctx: TenantContext,
  api: TelegramApi,
  grant: ReferralGrant | null | undefined,
) {
  return notifyReferralReward(ctx, grant, api);
}

async function showMyOrders(b: Bot) {
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

/**
 * «Оплатить остаток»: сумма с сервера (core/orders/balance), реквизиты
 * страны заказа и кнопка оплаты картой, если Robokassa подключена. Дальше
 * бот ждёт чек на остаток (awaiting_balance_proof).
 */
async function showBalancePayment(b: Bot, order: import("@/core/orders/orders").OrderWithItems) {
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
async function receiveBalanceProof(b: Bot, msg: TelegramMessage, orderId: number) {
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

/** Выдать позицию на выбранном языке; последний ответ закрывает заказ. */
async function deliverInLanguage(b: Bot, orderId: number, itemId: string, lang: Locale) {
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

// ── callback-кнопки ───────────────────────────────────────────────────

const NAV_NEEDS_COUNTRY = /^(cat:|prod:|checkout$|cart:show$)/;

async function handleCallback(
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
    const { homeworkDecision } = await import("./homework-review");
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
  const b: Bot = { ctx, api, chatId, customer, locale, m: COPY[locale] };

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
    const { giveawayEntry, giveawayIdFrom } = await import("./giveaway");
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
    const { showLessonList, showLesson } = await import("./courses");
    return data.startsWith("lsl:") ? showLessonList(b, data) : showLesson(b, data);
  }
  if (/^q[zad]:/.test(data) && ctx.tenant.modules.courses) {
    const { startQuiz, answerQuiz } = await import("./course-quiz");
    return data.startsWith("qz:")
      ? startQuiz(b, data)
      : answerQuiz(b, data, cq.message?.message_id);
  }
  if (data.startsWith("opl:") && ctx.tenant.modules.courses) {
    const { showOpenLesson } = await import("./courses");
    return showOpenLesson(b, data);
  }
  if (data.startsWith("lv:") && ctx.tenant.modules.courses) {
    const { showLives } = await import("./courses");
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

async function adminDecision(
  ctx: TenantContext,
  api: TelegramApi,
  fromId: number,
  chatId: number,
  data: string,
) {
  const admins = await shopAdminIds(ctx);
  // Ответы продавцу — на его языке; покупателю — на языке покупателя (m ниже).
  const { SELLER_DECISION } = await import("./seller-decision-texts");
  const { sellerLocale } = await import("@/core/catalog/low-stock");
  const st = SELLER_DECISION[await sellerLocale(ctx)];
  if (!admins.includes(String(fromId))) {
    await api.call("sendMessage", { chat_id: chatId, text: st.onlyAdmin });
    return;
  }
  const orderId = Number(data.split(":")[1]);
  const order = await getOrder(ctx, orderId);
  if (!order)
    return void (await api.call("sendMessage", { chat_id: chatId, text: st.notFound(orderId) }));
  const no = displayNo(order);
  const buyerLocale: Locale = await orderBuyerLocale(ctx, order);
  const m = COPY[buyerLocale];
  // Покупатель из Instagram/WhatsApp — ответы и выдача уходят через Zernio.
  const { sendToZernioTarget, zernioTargetForOrder } =
    await import("@/channels/zernio/outbound.server");
  const zernioTarget = await zernioTargetForOrder(ctx, order);
  const tellBuyer = async (text: string) => {
    if (zernioTarget) await sendToZernioTarget(zernioTarget, text);
    else if (orderChannel(order.platform) === "telegram")
      await api.call("sendMessage", { chat_id: order.telegram_id, text });
  };

  // Решение принято — кнопки уведомления у всех продавцов снимаем, через 5 минут
  // само уведомление уйдёт из чатов (как в v1).
  const { scheduleOrderNotifyDismiss } = await import("./order-notify");
  const decided = () => scheduleOrderNotifyDismiss(ctx, api, orderId);

  if (data.startsWith("reject:")) {
    const ok = await rejectOrder(ctx, orderId, "admin");
    await api.call("sendMessage", {
      chat_id: chatId,
      text: ok ? st.rejected(no) : st.alreadyClosed(no, order.status),
    });
    if (ok) await tellBuyer(m.orderRejected(no));
    await decided();
    return;
  }
  if (order.fulfillment_kind === "physical") {
    // Тот же путь, что и в админке: с чеком пишется задаток, повтор не двоит.
    const { acceptPhysicalOrder } = await import("@/core/orders/physical-admin");
    const r = await acceptPhysicalOrder(ctx, orderId, "admin");
    if (!r.ok) {
      await api.call("sendMessage", {
        chat_id: chatId,
        text: st.alreadyAcceptedOrClosed(no, order.status),
      });
      return;
    }
    await api.call("sendMessage", { chat_id: chatId, text: st.accepted(no) });
    await tellBuyer(m.orderAccepted(no));
    // Физический заказ ведётся дальше теми же сообщениями: кнопки следующего шага.
    const { refreshOrderNotifyButtons } = await import("./order-notify");
    const { orderStepKeyboard } = await import("./order-notify-keys");
    await refreshOrderNotifyButtons(
      ctx,
      api,
      orderId,
      orderStepKeyboard({ id: orderId, status: "accepted" }, await sellerLocale(ctx)),
    );
    return;
  }
  let sender = telegramMaterialSender(api, order.telegram_id, m);
  const web = orderChannel(order.platform) === "web";
  if (zernioTarget) {
    // Окно 24 часа закрыто — причину и ссылку на заказ продавец получит отдельным уведомлением.
    const { zernioDeliverySender } = await import("@/channels/zernio/outbound.server");
    sender = (await zernioDeliverySender(ctx, zernioTarget, order)).send;
  } else if (web) {
    // Заказ с сайта: материалы — на странице заказа и копией на почту.
    const { webMaterialSender } = await import("@/core/storefront/web-order");
    sender = webMaterialSender;
  } else if (orderChannel(order.platform) !== "telegram") {
    await api.call("sendMessage", {
      chat_id: chatId,
      text: st.noDialog(no, order.platform),
    });
    return;
  }
  const r = await deliverOrder(
    ctx,
    orderId,
    sender,
    zernioTarget || web
      ? { lang: buyerLocale, allWhenAmbiguous: true, actor: "admin" }
      : {
          lang: buyerLocale,
          ask: telegramLanguageAsker(api, order.telegram_id, m),
          actor: "admin",
        },
  );
  // Частичная выдача возвращает заказ на проверку — там кнопки ещё нужны.
  if (r.failed === 0) await decided();
  if (r.alreadyDelivered)
    return void (await api.call("sendMessage", {
      chat_id: chatId,
      text: st.alreadyDelivered(no),
    }));
  if (r.failed === 0 && r.pending > 0)
    return void (await api.call("sendMessage", {
      chat_id: chatId,
      text: st.languageAsked(no, r.pending),
    }));
  if (r.failed === 0) {
    const { deliveredMessage } = await import("@/core/delivery/note.server");
    await tellBuyer(await deliveredMessage(ctx, order.platform, m.orderDelivered(no)));
    if (r.pointsEarned > 0) await tellBuyer(m.pointsEarned(r.pointsEarned));
    await notifyReferral(ctx, api, r.referral);
    await api.call("sendMessage", {
      chat_id: chatId,
      text: st.delivered(no, r.sent),
    });
  } else {
    await api.call("sendMessage", {
      chat_id: chatId,
      text: st.partial(no, r.sent, r.failed),
    });
  }
}

/**
 * Кнопки шага физического заказа («В работу», «Собран», «Отправлен», «Выдан»)
 * и «Написать покупателю» под уведомлением продавцу. Шаг — тот же
 * setPhysicalStatus, что и в админке, условная запись по статусу: двойное
 * нажатие или кнопка устаревшего статуса ничего не пишут и не шлют.
 */
async function adminOrderButton(
  ctx: TenantContext,
  api: TelegramApi,
  fromId: number,
  chatId: number,
  data: string,
) {
  const { shopAdminIds } = await import("@/core/notify/recipients");
  const { SELLER_DECISION } = await import("./seller-decision-texts");
  const { sellerLocale } = await import("@/core/catalog/low-stock");
  const sLocale = await sellerLocale(ctx);
  const st = SELLER_DECISION[sLocale];
  const say = (text: string) => api.call("sendMessage", { chat_id: chatId, text });
  if (!(await shopAdminIds(ctx)).includes(String(fromId))) return void (await say(st.onlyAdmin));
  const [kind, idRaw, stepRaw] = data.split(":");
  const orderId = Number(idRaw);
  const order = Number.isInteger(orderId) ? await getOrder(ctx, orderId) : null;
  if (!order) return void (await say(st.notFound(orderId)));
  const no = displayNo(order);

  if (kind === "owr") {
    if (orderChannel(order.platform) === "manual" || orderChannel(order.platform) === "web")
      return void (await say(st.writeNoChat(no)));
    const { orderWriteRefLine } = await import("./order-notify-keys");
    await say(`${st.writePrompt(no)}\n${orderWriteRefLine(orderId)}`);
    return;
  }

  if (kind === "otr") {
    if (order.fulfillment_kind !== "physical" || !["ready", "delivered"].includes(order.status))
      return void (await say(st.trackNeedReady(no, order.status)));
    const { orderTrackRefLine } = await import("./order-notify-keys");
    await say(`${st.trackPrompt(no)}\n${orderTrackRefLine(orderId)}`);
    return;
  }

  const { isOrderStep, ORDER_STEPS } = await import("./order-notify-keys");
  if (!stepRaw || !isOrderStep(stepRaw) || order.fulfillment_kind !== "physical")
    return void (await say(st.stepStale(no, order.status)));
  const { from, to } = ORDER_STEPS[stepRaw];
  const { setPhysicalStatus } = await import("@/core/orders/admin");
  // Условная запись: выигрывает одно нажатие, остальные видят «статус уже изменился».
  if (!(await setPhysicalStatus(ctx, orderId, from, to)))
    return void (await say(st.stepStale(no, order.status)));
  const { recordOrderEvent } = await import("@/core/orders/events");
  await recordOrderEvent(ctx, orderId, "status", { to, step: stepRaw }, "admin");
  const m = COPY[await orderBuyerLocale(ctx, order)];
  const { sendToZernioTarget, zernioTargetForOrder } =
    await import("@/channels/zernio/outbound.server");
  const target = await zernioTargetForOrder(ctx, order);
  const notice = stepRaw === "shipped" ? m.orderShipped(no) : m.orderStatusNotice(to, no);
  if (target) await sendToZernioTarget(target, notice);
  else if (orderChannel(order.platform) === "telegram")
    await api.call("sendMessage", { chat_id: order.telegram_id, text: notice });
  await say(st.stepDone(no, stepRaw));
  await afterOrderStep(ctx, api, order, to, sLocale);
}

/** После шага: кнопки следующего шага, а у выданного — снять уведомление и наградить пригласившего. */
async function afterOrderStep(
  ctx: TenantContext,
  api: TelegramApi,
  order: NonNullable<Awaited<ReturnType<typeof getOrder>>>,
  to: string,
  sLocale: Locale,
) {
  const orderId = order.id;
  const no = displayNo(order);
  const { orderStepKeyboard } = await import("./order-notify-keys");
  const { refreshOrderNotifyButtons, scheduleOrderNotifyDismiss } = await import("./order-notify");
  const keyboard = orderStepKeyboard({ id: orderId, status: to }, sLocale);
  if (keyboard.length) await refreshOrderNotifyButtons(ctx, api, orderId, keyboard);
  else {
    await scheduleOrderNotifyDismiss(ctx, api, orderId);
    // Выдан — как в админке: награда пригласившему за первую выдачу.
    const { rewardReferrerIfFirstDelivery } = await import("@/core/referrals/referrals");
    const grant = await rewardReferrerIfFirstDelivery(ctx, order.telegram_id).catch((e) => {
      console.error(`[tg] награда пригласившему, заказ #${no}: ${String(e)}`);
      return null;
    });
    await notifyReferral(ctx, api, grant);
  }
}

/**
 * Ответ продавца свайпом на «Написать покупателю»: текст уходит покупателю в
 * его канал. Instagram/WhatsApp вне окна 24 часа — честный отказ, не повтор.
 * false — это не такой ответ.
 */
async function relayOrderReply(
  ctx: TenantContext,
  api: TelegramApi,
  msg: TelegramMessage,
): Promise<boolean> {
  const { orderWriteRefOf } = await import("./order-notify-keys");
  const orderId = orderWriteRefOf(msg.reply_to_message?.text);
  if (!orderId || !msg.from) return false;
  const { shopAdminIds } = await import("@/core/notify/recipients");
  if (!(await shopAdminIds(ctx)).includes(String(msg.from.id))) return false;
  const { SELLER_DECISION } = await import("./seller-decision-texts");
  const { sellerLocale } = await import("@/core/catalog/low-stock");
  const st = SELLER_DECISION[await sellerLocale(ctx)];
  const say = (text: string) => api.call("sendMessage", { chat_id: msg.chat.id, text });
  const order = await getOrder(ctx, orderId);
  if (!order) {
    await say(st.notFound(orderId));
    return true;
  }
  const no = displayNo(order);
  const text = msg.text!.trim();
  const { sendToZernioTargetResult, zernioTargetForOrder } =
    await import("@/channels/zernio/outbound.server");
  const target = await zernioTargetForOrder(ctx, order);
  if (target) {
    const { relayToBuyer } = await import("./relay-send");
    const out = await relayToBuyer(
      () => sendToZernioTargetResult(target, escapeHtml(text)),
      target.platform,
      st,
    );
    await say(out.ok ? st.writeSent(no) : out.say);
    return true;
  }
  if (orderChannel(order.platform) !== "telegram") {
    await say(st.writeNoChat(no));
    return true;
  }
  const res = await api.call("sendMessage", { chat_id: order.telegram_id, text });
  await say(res.ok ? st.writeSent(no) : st.writeNotSent);
  return true;
}

/**
 * Ответ продавца свайпом на «Отправлен + трек»: номер (или ссылка) → заказ
 * «отправлен» и один раз сообщение покупателю с номером и ссылкой по формату.
 * Заказ собран — шаг делает условная запись, как у кнопки; «один раз» держит
 * запись события по номеру: тот же номер второй раз не уходит, исправленный — уходит.
 * false — это не такой ответ.
 */
async function trackReply(
  ctx: TenantContext,
  api: TelegramApi,
  msg: TelegramMessage,
): Promise<boolean> {
  const { orderTrackRefOf } = await import("./order-notify-keys");
  const orderId = orderTrackRefOf(msg.reply_to_message?.text);
  if (!orderId || !msg.from) return false;
  const { shopAdminIds } = await import("@/core/notify/recipients");
  if (!(await shopAdminIds(ctx)).includes(String(msg.from.id))) return false;
  const { SELLER_DECISION } = await import("./seller-decision-texts");
  const { sellerLocale } = await import("@/core/catalog/low-stock");
  const sLocale = await sellerLocale(ctx);
  const st = SELLER_DECISION[sLocale];
  const say = (text: string) => api.call("sendMessage", { chat_id: msg.chat.id, text });
  const order = await getOrder(ctx, orderId);
  if (!order) {
    await say(st.notFound(orderId));
    return true;
  }
  const no = displayNo(order);
  const { trackingFromText, trackingKey, trackingMessage, trackingPayload } =
    await import("@/core/orders/tracking");
  const track = trackingFromText(msg.text);
  if (!track) {
    await say(st.trackBad);
    return true;
  }
  if (
    order.fulfillment_kind !== "physical" ||
    (order.status !== "ready" && order.status !== "delivered")
  ) {
    await say(st.trackNeedReady(no, order.status));
    return true;
  }
  const { recordOrderEvent, claimOrderEvent } = await import("@/core/orders/events");
  if (order.status === "ready") {
    const { setPhysicalStatus } = await import("@/core/orders/admin");
    if (await setPhysicalStatus(ctx, orderId, "ready", "delivered")) {
      await recordOrderEvent(ctx, orderId, "status", { to: "delivered", step: "shipped" }, "admin");
      await afterOrderStep(ctx, api, order, "delivered", sLocale);
    }
  }
  const label = track.number ?? track.url ?? "";
  // «Один раз»: запись события до отправки; второй такой же ответ ничего не шлёт.
  if (
    !(await claimOrderEvent(
      ctx,
      orderId,
      "tracking",
      trackingKey(track),
      trackingPayload(track),
      "admin",
    ))
  ) {
    await say(st.trackAlready(no, label));
    return true;
  }
  const text = trackingMessage(await orderBuyerLocale(ctx, order), no, track);
  const { sendToZernioTargetResult, zernioTargetForOrder } =
    await import("@/channels/zernio/outbound.server");
  const target = await zernioTargetForOrder(ctx, order);
  if (target) {
    const { relayToBuyer } = await import("./relay-send");
    const out = await relayToBuyer(
      () => sendToZernioTargetResult(target, escapeHtml(text)),
      target.platform,
      st,
    );
    await say(out.ok ? st.trackSent(no, label) : out.say);
  } else if (orderChannel(order.platform) === "telegram") {
    const res = await api.call("sendMessage", { chat_id: order.telegram_id, text });
    await say(res.ok ? st.trackSent(no, label) : st.writeNotSent);
  } else await say(st.trackNoChat(no));
  return true;
}

/**
 * Ответ продавца на уведомление «Клиент ждёт менеджера» (core/consultant/relay):
 * метка в тексте уведомления → покупатель → сообщение ему в Instagram/WhatsApp.
 * false — это не такой ответ, сообщение обрабатывается как обычно.
 */
async function relayManagerReply(
  ctx: TenantContext,
  api: TelegramApi,
  msg: TelegramMessage,
): Promise<boolean> {
  const { handoffRefOf, resolveHandoffRef } = await import("@/core/consultant/relay");
  const token = handoffRefOf(msg.reply_to_message?.text ?? msg.reply_to_message?.caption);
  if (!token || !msg.from) return false;
  const { shopAdminIds } = await import("@/core/notify/recipients");
  if (!(await shopAdminIds(ctx)).includes(String(msg.from.id))) return false;
  const { SELLER_DECISION } = await import("./seller-decision-texts");
  const { sellerLocale } = await import("@/core/catalog/low-stock");
  const st = SELLER_DECISION[await sellerLocale(ctx)];
  const reply = (text: string) => api.call("sendMessage", { chat_id: msg.chat.id, text });
  const userKey = await resolveHandoffRef(ctx, token);
  const buyer = userKey ? await getCustomer(ctx, userKey) : null;
  const { sendToZernioTargetResult, zernioTargetOf } =
    await import("@/channels/zernio/outbound.server");
  const target = zernioTargetOf(buyer);
  if (!buyer || !target) {
    await reply(st.relayNoDialog);
    return true;
  }
  const text = msg.text!.trim();
  const { relayToBuyer } = await import("./relay-send");
  const out = await relayToBuyer(
    () => sendToZernioTargetResult(target, escapeHtml(text)),
    target.platform,
    st,
  );
  if (!out.ok) {
    await reply(out.say);
    return true;
  }
  const { recordRelayedReply } = await import("@/core/consultant/engine.server");
  await recordRelayedReply(ctx, buyer, text);
  if (ctx.tenant.modules.manager_chat) {
    const { recordMessage } = await import("@/core/chat/chat");
    await recordMessage(ctx, {
      telegramId: buyer.telegramId,
      direction: "out",
      sender: "manager",
      text,
    }).catch(() => {});
  }
  await reply(st.relaySent);
  return true;
}
