import {
  nonTextKind,
  NON_TEXT_WINDOW_MS,
  PHOTO_FORWARDED,
  SELLER_PHOTO,
  TEXT_ONLY,
} from "./nontext";
import { sellerWroteWithin } from "./manager-guard";
import { env } from "@/config/env";
import { recordEngage } from "@/core/automsg/engage";
import { shownLeadDays } from "@/core/catalog/lead-time";
import { orderChannel } from "@/core/orders/pure";
import type { TenantContext } from "@/core/tenant/resolve.server";
import {
  setContactPhone,
  noteChatPhone,
  claimStateSection,
  setEmail,
  setState,
  type Customer,
  type DialogState,
} from "@/core/customers/customers";
import type { Json } from "@/core/db-types";
import { isLocale, localeNames, type Locale } from "@/core/i18n/locale";
import {
  getProduct,
  listChildCategories,
  listProductsInCategory,
  searchProducts,
  sortedImages,
  sortedVariants,
  type Product,
} from "@/core/catalog/catalog";
import {
  addToCart,
  cartCount,
  clearCart,
  listCart,
  priceCart,
  removeCartItem,
} from "@/core/cart/cart";
import { formatMoney } from "@/core/money/money";
import { resolvePrice, strikePrice } from "@/core/pricing/pricing";
import {
  attachPaymentProof,
  markProofVerified,
  PROOF_SWAPPED_NOTE,
  cartSummary,
  deliverOrder,
  displayNo,
  getOrder,
  setOrderEmail,
  listActivePaymentMethods,
  listCustomerOrders,
  placeOrder,
  recentAwaitingPaymentOrder,
  type OrderWithItems,
  reorderIntoCart,
} from "@/core/orders/orders";
import { GIFT_MESSAGE_MAX, GIFT_NAME_MAX, normalizeGift } from "@/core/orders/gift";
import { giftWrapForCart } from "@/core/orders/gift-wrap";
import {
  activeDeliveryZones,
  amountDueNow,
  fulfillmentSettings,
  checkFulfillmentDate,
  earliestFulfillmentDate,
  zoneFee,
} from "@/core/fulfillment/fulfillment";
import { closedRules, describeClosed, hasClosedDays } from "@/core/fulfillment/closed-days";
import { dateAvailability, freeSlotsOnDate } from "@/core/fulfillment/capacity";
import { isoToDisplay, parseDateInput } from "@/core/fulfillment/pure";
import { robokassaFor, robokassaReceipt } from "@/core/payments/payment";
import { buildPaymentUrl } from "@/core/payments/robokassa";
import { formatRatingSummary } from "@/core/reviews/pure";
import { parseRatingReply } from "@/core/reviews/ask";
import { loadQuiz, quizAnswer, quizResult, type Quiz } from "@/core/quiz/quiz";
import { hasDeliveredPurchase, saveRating } from "@/core/reviews/reviews";
import { REPLY_WINDOW_MS } from "@/core/chat/reply-window";
import { isDeliveryLangChoice } from "@/core/catalog/materials";
import { askDeliveryLangBeforeOrder, cartLanguageChoices } from "@/core/cart/languages";
import { belowMinimum } from "@/core/cart/min-order";
import { freeDeliveryView } from "@/core/fulfillment/free-delivery-cart";
import { localeFlags as flags, SUPPORTED_LOCALES } from "@/core/i18n/locale";
import {
  COPY,
  escapeHtml,
  freeDeliveryText,
  minOrderText,
  normalizePhone,
  type Msg,
} from "@/channels/telegram/copy";
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
import {
  adminTelegramApi,
  notifyAdminsHtml,
  notifyDeliveryFailure,
} from "@/channels/telegram/notify";
import {
  downloadAttachment,
  refreshAttachmentUrl,
  liveTransport,
  type DmButton,
  type ZernioTransport,
} from "./api.server";
import { zernioMaterialSender } from "./deliver";
import { isAttachmentRejected } from "./errors";
import { isMailConfigured } from "@/core/mail/mail.server";
import type { NativeOrder, ParsedZernioMessage } from "./message";
import { describeNativeCart, matchNativeItems } from "@/core/whatsapp/native-cart";
import { PLATFORM_LABEL, type ZernioPlatform } from "./platform";
import {
  classifyIncoming,
  emailStep,
  extractEmail,
  extractProductNumber,
  isCancel,
  isPaymentComplaint,
  matchCountry,
  matchDeliveryLangChoice,
  matchLoyaltyPointsChoice,
  matchDirectCommand,
  type DirectCommand,
  matchLocalePick,
  languagePickerText,
  stepAnswer,
  rowSubtitle,
  whatsappList,
  STEP_PREFIX,
  WA_LIST_MAX_ROWS,
  WA_LIST_PAGE,
  MAX_LOCALE_MISSES,
  isStepStale,
  MULTI_ADD_COPY,
  ONE_SECTION_HINT,
  PRODUCT_LIST_HINT,
  matchOrdinal,
  clipRowTitle,
  matchZone,
  parseRemoveCommand,
  pickCartLineToRemove,
  pickReceiptAttachment,
  plain,
  productNumberFromKeywords,
  productNumberFromName,
  cartCardText,
} from "./shop-flow";
import { matchFulfillmentType } from "@/core/fulfillment/pure";
import {
  DEFAULT_DIRECT_BOT,
  isStartPostback,
  isTriggerWord,
  type DirectBotSettings,
} from "@/core/instagram/direct-bot-settings";
import { iceBreakerKind, type IceBreakerKind } from "@/core/instagram/ice-breakers";
import { serverFailure } from "@/lib/server-failure";

/**
 * Магазин в Instagram Direct и WhatsApp (модули dm_shop / wa_shop). Тот же
 * сценарий, что у Telegram-бота, но текстом и тремя кнопками: у Direct нет
 * /start, клавиатур и документов, поэтому списки нумеруются, выбор — номером
 * или словом, а материалы выдаются ссылками. Бизнес-правила — в ядре.
 */
export type ShopOutcome =
  /** Ответили по сценарию. */
  | "handled"
  /** Свободный вопрос — пусть отвечает консультант или продавец. */
  | "question";

type DirectMemory = {
  /** Показанный нумерованный список: категории или товары. */
  list?: { kind: "categories" | "products" | "variants"; ids: string[]; at: string };
  last_reply?: string;
  last_reply_at?: string;
  locale_picked_at?: string;
  variant_product?: string;
  /** WhatsApp: покупатель отказался от почты — больше не спрашиваем. */
  email_skipped?: boolean;
  /** Быстрый вопрос «Связаться с продавцом»: следующий вопрос — продавцу (handle-message). */
  contact_requested_at?: string;
  /** Страну спросили первым делом: что показать после ответа (каталог или товар). */
  after_country?: string;
  /** Когда в последний раз отвечали на голосовое/стикер/фото вне оплаты (Б6). */
  nontext_at?: string;
  /** Последний ответ бота — подсказка на нераспознанный ответ шага (строгий режим). */
  hinted?: boolean;
};

type Shop = {
  /** Время сообщения покупателя по часам Zernio, мс; нет — считаем свежим. */
  inboundAt: number | null;
  ctx: TenantContext;
  customer: Customer;
  transport: ZernioTransport;
  conversationId: string;
  accountId: string;
  platform: ZernioPlatform;
  locale: Locale;
  m: Msg;
  /** Настройки автоответчика канала: слова-вызовы и что из магазина включено. */
  bot: DirectBotSettings;
  /** Ответ этого сообщения — подсказка на нераспознанный ответ шага. */
  hint?: boolean;
};

/**
 * Строгий режим «Только по заказам» (Educational Bot, 03.10: «бот реагирует
 * на обычные сообщения, люди путаются»). Бот отвечает, только когда к нему
 * обращаются: кнопка, «старт»/«каталог»/слово-вызов, код материала (#245 или
 * номер, который есть в каталоге), чек к ждущему оплаты заказу — и в живом
 * разговоре с ним (последний ответ бота не старше получаса). Нераспознанный
 * ответ на вопрос бота — одна подсказка сразу после вопроса, дальше тишина:
 * переписка с продавцом бота не будит и не путает покупателя.
 */
const ACTIVE_DIALOG_MS = 30 * 60_000;
/** Сколько после реплики продавца руками бот не вмешивается короткими «записал». */
const SELLER_ACTIVE_MS = 30 * 60_000;
const HINT_WINDOW_MS = 10 * 60_000;

function strict(s: Shop): boolean {
  return s.bot.scope === "purchases";
}

function sinceBotReply(s: Shop): number {
  const at = Date.parse(memory(s.customer).last_reply_at ?? "");
  return Number.isFinite(at) ? Date.now() - at : Infinity;
}

/** Бот в разговоре: в строгом режиме — только пока ответ бота свежий. */
function inDialog(s: Shop): boolean {
  return !strict(s) || sinceBotReply(s) < ACTIVE_DIALOG_MS;
}

/** Подсказка на нераспознанный ответ: одна и только сразу после вопроса бота. */
function mayHint(s: Shop): boolean {
  if (!strict(s)) return true;
  return !memory(s.customer).hinted && sinceBotReply(s) < HINT_WINDOW_MS;
}

/** Похож ли текст на ответ текущего шага. Свободный ввод (адрес, заметка) — всегда. */
async function stepAnswerFits(s: Shop, mode: string, text: string): Promise<boolean> {
  switch (mode) {
    case "awaiting_locale":
      return matchLocalePick(text) !== null;
    case "awaiting_country": {
      const methods = await listActivePaymentMethods(s.ctx);
      return (
        matchCountry(
          text,
          methods.map((x) => ({ code: x.country_code, name: x.country_name })),
        ) !== null
      );
    }
    case "awaiting_contact":
      return normalizePhone(text) !== null;
    case "awaiting_variant_choice": {
      const list = memory(s.customer).list;
      return matchOrdinal(text, list?.kind === "variants" ? list.ids.length : 0) !== null;
    }
    case "awaiting_delivery_lang":
      return matchDeliveryLangChoice(text, await cartLanguageChoices(s.ctx, s.customer)) !== null;
    case "awaiting_points_choice":
      return matchLoyaltyPointsChoice(text) !== null;
    // Подарок и упаковка: непонятный ответ шаг разбирает сам (переспрос один раз, потом
    // «нет»), поэтому в строгом режиме реплика не уходит продавцу.
    case "awaiting_gift_choice":
    case "awaiting_gift_wrap":
      return true;
    case "awaiting_fulfillment_type":
      return matchFulfillmentType(text) !== null;
    case "awaiting_fulfillment_date":
      return parseDateInput(text) !== null;
    case "awaiting_delivery_zone":
      return matchZone(text, await activeDeliveryZones(s.ctx)) !== null;
    case "awaiting_email":
    case "awaiting_order_email":
      return extractEmail(text) !== null;
    case "awaiting_quiz": {
      const quiz = await loadQuiz(s.ctx);
      const q = Number(s.customer.state.quiz_q) || 0;
      return matchOrdinal(text, quiz.questions[q]?.options.length ?? 0) !== null;
    }
    default:
      return true;
  }
}

/** Фото для Instagram/WhatsApp: первое, которое канал примет (JPEG/PNG в пределах лимита). */
async function photoFor(
  s: Shop,
  paths: ReadonlyArray<string | null | undefined>,
): Promise<string | undefined> {
  // Без проверки фото (транспорт в тестах) — без фото: непроверенное Meta может отклонить.
  if (!s.transport.imageInfo) return undefined;
  const { zernioImageUrl } = await import("./media.server");
  return (await zernioImageUrl(s.ctx, s.platform, paths, s.transport.imageInfo)) ?? undefined;
}

const LIST_TTL_MS = 30 * 60 * 1000;
const REPEAT_WINDOW_MS = 90 * 1000;
const PAGE = 10;

function memory(c: Customer): DirectMemory {
  const d = c.state.direct;
  return d && typeof d === "object" && !Array.isArray(d) ? (d as DirectMemory) : {};
}

async function remember(s: Shop, patch: Partial<DirectMemory>, state?: Partial<DialogState>) {
  const next = { ...memory(s.customer), ...patch };
  s.customer = await setState(s.ctx, s.customer, {
    ...s.customer.state,
    ...(state ?? {}),
    direct: next as Record<string, Json | undefined>,
  });
}

async function setMode(s: Shop, state: Partial<DialogState>) {
  s.customer = await setState(s.ctx, s.customer, { ...s.customer.state, ...state });
}

function localeOf(ctx: TenantContext, customer: Customer): Locale {
  const fromState = customer.state.locale;
  if (isLocale(fromState)) return fromState;
  return ctx.tenant.settings.default_locale ?? "ru";
}

function fingerprint(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 200);
}

/**
 * Все ответы — через эту точку: повтор одного текста подряд подавляется
 * (доставка вебхука at-least-once, «Корзина пуста» дважды — из живой
 * переписки v1), неотправленный ответ последним не считается. `force` —
 * покупатель сам повторно вызвал то же меню.
 */
async function reply(
  s: Shop,
  html: string,
  opts: { buttons?: DmButton[]; attachmentUrl?: string; force?: boolean; interactive?: Json } = {},
): Promise<boolean> {
  const text = plain(html).slice(0, 2000);
  const mem = memory(s.customer);
  const mark = fingerprint(text);
  const fresh =
    Boolean(mem.last_reply_at) && Date.now() - Date.parse(mem.last_reply_at!) < REPEAT_WINDOW_MS;
  if (!opts.force && mem.last_reply === mark && fresh) return false;
  const send = (attachmentUrl?: string) =>
    s.transport.send(s.conversationId, s.accountId, text, {
      platform: s.platform,
      buttons: opts.buttons,
      attachmentUrl,
      attachmentType: attachmentUrl ? "image" : undefined,
      interactive: opts.interactive,
    });
  let r = await send(opts.attachmentUrl);
  // Фото не приняли (формат, размер, ссылка) — карточка важнее картинки: текстом.
  // Иной отказ (окно 24 часа, доступ, лимит) без фото тоже не пройдёт — не повторяем.
  if (!r.ok && opts.attachmentUrl && isAttachmentRejected(r.failure)) {
    console.warn(`[zernio-shop] фото не принято для ${s.customer.userKey}: ${r.error}`);
    r = await send();
  }
  if (!r.ok) {
    console.error(`[zernio-shop] reply failed for ${s.customer.userKey}: ${r.error}`);
    return false;
  }
  await remember(s, {
    last_reply: mark,
    last_reply_at: new Date().toISOString(),
    hinted: s.hint === true ? true : undefined,
  });
  if (s.ctx.tenant.modules.manager_chat) {
    const { recordMessage } = await import("@/core/chat/chat");
    await recordMessage(s.ctx, {
      telegramId: s.customer.telegramId,
      direction: "out",
      sender: "bot",
      text,
    });
  }
  return true;
}

const BTN = {
  cart: (m: Msg): DmButton => ({ type: "postback", title: plain(m.cart), payload: "CART" }),
  catalog: (m: Msg): DmButton => ({
    type: "postback",
    title: plain(m.catalog),
    payload: "CATALOG",
  }),
  checkout: (m: Msg): DmButton => ({
    type: "postback",
    title: plain(m.checkoutBtn),
    payload: "CHECKOUT",
  }),
  clear: (m: Msg): DmButton => ({ type: "postback", title: plain(m.clearBtn), payload: "CLEAR" }),
  orders: (m: Msg): DmButton => ({ type: "postback", title: plain(m.myOrders), payload: "ORDERS" }),
  quiz: (m: Msg): DmButton => ({
    type: "postback",
    title: plain(m.quizBtn).slice(0, 20),
    payload: "QUIZ",
  }),
};

function hint(s: Shop): string {
  return s.locale === "ru"
    ? "Напишите номер товара или «каталог»; «корзина» — что уже выбрано."
    : `${plain(s.m.catalog)} · ${plain(s.m.cart)} · ${plain(s.m.myOrders)}`;
}

export async function handleShopMessage(
  ctx: TenantContext,
  customer: Customer,
  msg: ParsedZernioMessage,
  transport: ZernioTransport = liveTransport,
  bot: DirectBotSettings = DEFAULT_DIRECT_BOT,
): Promise<{ outcome: ShopOutcome; customer: Customer }> {
  const locale = localeOf(ctx, customer);
  const s: Shop = {
    ctx,
    customer,
    transport,
    conversationId: msg.conversationId!,
    accountId: msg.accountId!,
    platform: msg.platform,
    locale,
    m: COPY[locale],
    bot,
    inboundAt:
      msg.sentAt && Number.isFinite(Date.parse(msg.sentAt)) ? Date.parse(msg.sentAt) : null,
  };
  const outcome = await route(s, msg);
  return { outcome, customer: s.customer };
}

/** true — реплика была оценкой и обработана; false — шаг снят, разбираем реплику как обычно. */
async function handleRatingAnswer(s: Shop, text: string): Promise<boolean> {
  const {
    review_product_id: productId,
    review_ask_at: askedAt,
    review_order_id: orderId,
    ...rest
  } = s.customer.state;
  const fresh = Date.now() - Date.parse(askedAt ?? "") < REPLY_WINDOW_MS;
  const rating = parseRatingReply(text);
  await setMode(s, {
    ...rest,
    mode: "idle",
    review_product_id: undefined,
    review_ask_at: undefined,
    review_order_id: undefined,
  });
  if (!fresh || rating == null || !productId || !s.ctx.tenant.modules.review_request) return false;
  const telegramId = s.customer.telegramId;
  if (!(await hasDeliveredPurchase(s.ctx, telegramId, productId))) {
    await reply(s, s.m.reviewNotAllowed, { force: true });
    return true;
  }
  await saveRating(s.ctx, telegramId, productId, rating);
  // В заказе есть ещё не оценённый товар — спрашиваем следующий тем же шагом. Это ответ в
  // открытом окне на цифру покупателя, а не новая маркетинговая отправка.
  const next = orderId
    ? (await (await import("@/core/reviews/ask")).unratedProducts(s.ctx, orderId, telegramId))[0]
    : undefined;
  if (!next) {
    await reply(s, s.m.ratingThanks, { force: true });
    return true;
  }
  await setMode(s, {
    ...rest,
    mode: "awaiting_rating",
    review_product_id: next.id,
    review_order_id: orderId,
    review_ask_at: new Date().toISOString(),
  });
  await reply(s, `${s.m.ratingThanks}\n\n${s.m.reviewAskDirect(next.name)}`, { force: true });
  return true;
}

async function route(s: Shop, msg: ParsedZernioMessage): Promise<ShopOutcome> {
  const text = msg.text;
  let mode = s.customer.state.mode;

  // Корзина из каталога Meta — штатная корзина WhatsApp мимо бота.
  if (msg.nativeOrder) return handleNativeCart(s, msg.nativeOrder);

  // Строка списка WhatsApp «STEP:<n>» — ответ на текущий шаг, как набранная цифра.
  const step = stepAnswer(msg.postbackPayload);
  if (step) return route(s, { ...msg, postbackPayload: null, text: step });
  // Кнопка «Купить» автоматизации с payload «/start» или словом-вызовом —
  // открыть магазин, как набранное слово-вызов (раньше уходила продавцу вопросом).
  if (isStartPostback(msg.postbackPayload, s.bot.triggers)) return openShop(s);
  const ib = iceBreakerKind(msg.postbackPayload);
  if (ib) return handleIceBreaker(s, ib);
  if (msg.postbackPayload) return handlePostback(s, msg.postbackPayload);

  // Вложение без ссылки (Zernio сменил форму события): если ждём чек — просим
  // прислать ещё раз, а не отвечаем как на вопрос и не теряем его молча.
  if (msg.mediaWithoutUrl && msg.attachments.length === 0 && !text) {
    const waiting =
      ((mode === "awaiting_proof" || mode === "awaiting_payment") &&
        s.customer.state.pending_order_id) ||
      (await recentAwaitingPaymentOrder(s.ctx, s.customer));
    if (waiting) {
      console.warn(`[zernio:${s.ctx.tenant.id}] вложение без ссылки на шаге оплаты`);
      await reply(s, s.m.proofFailed, { force: true });
      return "handled";
    }
  }

  // Вложение: чек на шаге оплаты или по свежему открытому заказу.
  if (msg.attachments.length > 0) {
    const url = pickReceiptAttachment(msg.attachments);
    let orderId =
      (mode === "awaiting_proof" || mode === "awaiting_payment") &&
      s.customer.state.pending_order_id
        ? Number(s.customer.state.pending_order_id)
        : null;
    if (!orderId) orderId = await recentAwaitingPaymentOrder(s.ctx, s.customer);
    if (orderId && url) {
      const index = msg.attachments.find((a) => a.url === url)?.index;
      const again =
        msg.platformMessageId && index != null
          ? { platformMessageId: msg.platformMessageId, index }
          : null;
      await receiveProof(s, url, orderId, again);
      return "handled";
    }
    if (orderId) {
      await reply(s, s.m.sendReceiptPrompt);
      return "handled";
    }
    return text ? route(s, { ...msg, attachments: [] }) : handleNonText(s, msg);
  }

  if (!text) return "question";

  // Просьба об оценке (core/reviews/ask): цифра 1–5 в окне ответа — оценка, любой
  // другой текст — обычная переписка, шаг снимается. Раньше шага «устарел»: просьба
  // уходит кроном и «последнюю реплику бота» не обновляет.
  if (mode === "awaiting_rating") {
    const answered = await handleRatingAnswer(s, text);
    if (answered) return "handled";
    mode = s.customer.state.mode;
  }

  // Шаг, заданный давно, реплику не забирает: это уже переписка с продавцом.
  // Язык сам не спрашивается (только словом «язык»): покупатели путались, а
  // бот просыпался на ответ продавцу (Educational Bot, 29.09).
  if (isStepStale(mode, memory(s.customer).last_reply_at)) {
    await setMode(s, { mode: "idle", placing_order: undefined, locale_misses: undefined });
    mode = "idle";
  }

  // «/start» — и слово отмены, и вызов магазина. Вне сценария и вне разговора с
  // ботом это вызов: иначе в строгом режиме (он по умолчанию) первое «/start»
  // покупателя молча уходило продавцу обращением (Копилка русоведа, 04.10).
  const idleNow = !mode || mode === "idle";
  const startCall = idleNow && !inDialog(s) && text.trim().toLowerCase() === "/start";
  if (isCancel(text) && !startCall) {
    if (idleNow && !inDialog(s)) return "question";
    await setMode(s, { mode: "idle" });
    await reply(s, `${plain(s.m.useMenu)}\n\n${hint(s)}`, {
      force: true,
      buttons: [BTN.catalog(s.m), BTN.cart(s.m)],
    });
    return "handled";
  }

  // Слова-вызовы продавца открывают магазин, как встроенная команда «каталог».
  const command = isTriggerWord(text, s.bot.triggers) ? "catalog" : matchDirectCommand(text);
  if (command) {
    if (!featureAllows(s, command)) return "question";
    // Строгий режим: «оплата», «страна», «язык» — частые слова в переписке с
    // продавцом; без живого разговора с ботом они его не будят.
    if (!["catalog", "cart", "orders", "points", "quiz"].includes(command) && !inDialog(s))
      return "question";
    if (mode && mode !== "idle" && mode !== "awaiting_proof") await setMode(s, { mode: "idle" });
    switch (command) {
      case "catalog":
        return openShop(s);
      case "cart":
        await showCart(s, true);
        return "handled";
      case "checkout":
        await startCheckout(s);
        return "handled";
      case "orders":
        await showOrders(s);
        return "handled";
      case "points":
        await showPoints(s);
        return "handled";
      case "language":
        await askLocale(s);
        return "handled";
      case "quiz":
        await startQuiz(s);
        return "handled";
      case "country":
        await askCountry(s, false);
        return "handled";
    }
  }

  // Строгий режим: на вопрос бота — только похожий ответ; иначе одна подсказка
  // сразу после вопроса, а дальше реплика остаётся продавцу.
  const paymentStep =
    mode === "awaiting_proof" || mode === "choose_pay" || mode === "awaiting_payment";
  if (
    strict(s) &&
    mode &&
    mode !== "idle" &&
    !paymentStep &&
    !(await stepAnswerFits(s, mode, text))
  ) {
    if (!mayHint(s)) return "question";
    s.hint = true;
  }

  // Шаги сценария — текстом.
  switch (mode) {
    case "awaiting_locale": {
      const picked = matchLocalePick(text);
      if (!picked) {
        const misses = Number(s.customer.state.locale_misses ?? 0) + 1;
        if (misses < MAX_LOCALE_MISSES) {
          await setMode(s, { locale_misses: misses });
          return askLocale(s).then(() => "handled" as const);
        }
        // Не упорствуем: дальше отвечаем на языке магазина и показываем каталог.
        await remember(
          s,
          { locale_picked_at: new Date().toISOString() },
          { mode: "idle", locale: s.locale, locale_misses: undefined },
        );
        await showCatalog(s, null, 0, true);
        return "handled";
      }
      await remember(
        s,
        { locale_picked_at: new Date().toISOString() },
        { mode: "idle", locale: picked, locale_misses: undefined },
      );
      s.locale = picked;
      s.m = COPY[picked];
      await reply(s, s.m.languageSaved, { force: true });
      await showCatalog(s, null, 0, true);
      return "handled";
    }
    case "awaiting_quiz": {
      const quiz = await loadQuiz(s.ctx);
      const q = Number(s.customer.state.quiz_q) || 0;
      const pick = matchOrdinal(text, quiz.questions[q]?.options.length ?? 0);
      const tags = Array.isArray(s.customer.state.quiz_tags)
        ? (s.customer.state.quiz_tags as string[])
        : [];
      const step = pick === null ? null : quizAnswer(quiz, tags, q, pick);
      // Не номер варианта: повторяем вопрос; вопроса уже нет (продавец поправил квиз) — сначала.
      if (!step) {
        await (quiz.questions[q] ? askQuizQuestion(s, quiz, q) : startQuiz(s));
        return "handled";
      }
      if (step.done) await finishQuiz(s, step.tags);
      else {
        await setMode(s, { quiz_tags: step.tags, quiz_q: step.next });
        await askQuizQuestion(s, quiz, step.next);
      }
      return "handled";
    }
    case "awaiting_country": {
      const methods = await listActivePaymentMethods(s.ctx);
      const picked = matchCountry(
        text,
        methods.map((x) => ({ code: x.country_code, name: x.country_name })),
      );
      if (!picked)
        return askCountry(s, s.customer.state.placing_order === true).then(
          () => "handled" as const,
        );
      const forCheckout = s.customer.state.placing_order === true;
      await setMode(s, {
        mode: "idle",
        country_code: picked.code,
        country_name: picked.name,
        placing_order: undefined,
      });
      await reply(s, s.m.countrySaved(picked.name), { force: true });
      if (forCheckout) await proceedToFulfillmentOrPlace(s, picked.code);
      else await continueAfterCountry(s);
      return "handled";
    }
    case "awaiting_contact": {
      const phone = normalizePhone(text);
      if (!phone) return reply(s, s.m.phoneInvalid).then(() => "handled" as const);
      s.customer = await setContactPhone(s.ctx, s.customer, phone);
      await setMode(s, { mode: "idle" });
      await reply(s, s.m.contactSaved, { force: true });
      await continueCheckout(s);
      return "handled";
    }
    case "awaiting_variant_choice": {
      const mem = memory(s.customer);
      const pid = mem.variant_product;
      const ids = mem.list?.kind === "variants" ? mem.list.ids : [];
      const idx = matchOrdinal(text, ids.length);
      if (pid && idx !== null) {
        await setMode(s, { mode: "idle" });
        await addAndShowCart(s, pid, ids[idx]!);
        return "handled";
      }
      if (pid) {
        const p = await getProduct(s.ctx, pid);
        if (p) return sendProductCard(s, p, true).then(() => "handled" as const);
      }
      await setMode(s, { mode: "idle" });
      break;
    }
    case "awaiting_delivery_lang": {
      const langs = await cartLanguageChoices(s.ctx, s.customer);
      const choice = matchDeliveryLangChoice(text, langs);
      const cc = s.customer.state.country_code;
      if (!choice || !cc)
        return proceedToLanguageOrPlace(s, cc ?? "").then(() => "handled" as const);
      await setMode(s, { mode: "idle", delivery_lang: choice });
      await finishCheckout(s, cc);
      return "handled";
    }
    case "awaiting_points_choice": {
      const choice = matchLoyaltyPointsChoice(text);
      const cc = s.customer.state.country_code;
      if (!choice || !cc) return askPoints(s).then(() => "handled" as const);
      await setMode(s, { mode: "idle", use_points: choice === "yes" });
      await finishCheckout(s, cc);
      return "handled";
    }
    case "awaiting_gift_choice": {
      const choice = matchLoyaltyPointsChoice(text);
      const cc = s.customer.state.country_code;
      if (!cc) return askGift(s).then(() => "handled" as const);
      // Непонятный ответ: переспросить один раз, потом считать «нет» и оформлять дальше.
      if (!choice && !s.customer.state.gift_reask) {
        await setMode(s, { gift_reask: true });
        return askGift(s).then(() => "handled" as const);
      }
      return afterGiftChoice(s, cc, choice === "yes").then(() => "handled" as const);
    }
    case "awaiting_gift_wrap": {
      const choice = matchLoyaltyPointsChoice(text);
      const cc = s.customer.state.country_code;
      if (!cc) return askGiftWrap(s).then(() => "handled" as const);
      if (!choice && !s.customer.state.gift_reask) {
        await setMode(s, { gift_reask: true });
        return askGiftWrap(s).then(() => "handled" as const);
      }
      await setMode(s, { mode: "idle", gift_wrap: choice === "yes", gift_reask: undefined });
      await finishCheckout(s, cc);
      return "handled";
    }
    case "awaiting_gift_recipient": {
      const g = normalizeGift({ recipient: text });
      await setMode(s, {
        mode: "awaiting_gift_message",
        gift_on: true,
        gift_recipient: g.recipient,
      });
      if (g.truncated) await reply(s, s.m.giftTruncatedNote(GIFT_NAME_MAX), { force: true });
      await askGiftMessage(s);
      return "handled";
    }
    case "awaiting_gift_message": {
      const g = normalizeGift({ message: text });
      if (g.truncated) await reply(s, s.m.giftTruncatedNote(GIFT_MESSAGE_MAX), { force: true });
      await finishAfterGift(s, g.message);
      return "handled";
    }
    case "awaiting_fulfillment_type": {
      const type = matchFulfillmentType(text);
      if (!type) return reply(s, s.m.fulfillmentTypePrompt).then(() => "handled" as const);
      await setMode(s, { checkout_fulfillment_type: type });
      await askFulfillmentDate(s);
      return "handled";
    }
    case "awaiting_fulfillment_date": {
      const iso = parseDateInput(text);
      const rules = await closedRules(s.ctx);
      // Минимум — на сегодня, а не на момент вопроса (сохранённая дата — только для текста).
      const minIso = await earliestFulfillmentDate(s.ctx, s.customer, rules);
      if (!iso) return reply(s, s.m.fulfillmentDateInvalid).then(() => "handled" as const);
      const check = checkFulfillmentDate(iso, minIso, rules);
      if (!check.ok)
        return reply(
          s,
          check.reason === "early"
            ? s.m.fulfillmentDateTooEarly(isoToDisplay(check.minDate))
            : s.m.fulfillmentDateClosed(isoToDisplay(check.nextDate)),
        ).then(() => "handled" as const);
      const avail = await dateAvailability(s.ctx, iso, rules);
      if (!avail.ok)
        return reply(
          s,
          s.m.fulfillmentDateFull(avail.nextDate ? isoToDisplay(avail.nextDate) : null),
        ).then(() => "handled" as const);
      await setMode(s, { checkout_fulfillment_at: iso });
      await afterDate(s);
      return "handled";
    }
    case "awaiting_fulfillment_slot": {
      const { fulfillmentSlots, normalizeSlot, withSlot } =
        await import("@/core/fulfillment/slots");
      const date = s.customer.state.checkout_fulfillment_at;
      // Номер в списке — среди свободных слотов, как их видел покупатель (afterDate).
      const slots = date ? await freeSlotsOnDate(s.ctx, date) : await fulfillmentSlots(s.ctx);
      const all = await fulfillmentSlots(s.ctx);
      const n = /^\s*(\d{1,2})\s*$/.exec(text)?.[1];
      const named = n ? undefined : all.find((x) => x === normalizeSlot(text));
      if (named && !slots.includes(named)) await reply(s, s.m.fulfillmentSlotFull);
      const slot = n ? slots[Number(n) - 1] : slots.find((x) => x === named);
      if (!slot || !date) {
        await setMode(s, { checkout_fulfillment_at: date?.slice(0, 10) });
        await afterDate(s);
        return "handled";
      }
      await setMode(s, { checkout_fulfillment_at: withSlot(date, slot) });
      await afterDate(s);
      return "handled";
    }
    case "awaiting_delivery_zone": {
      const zones = await activeDeliveryZones(s.ctx);
      const z = matchZone(text, zones);
      if (!z) return askZoneOrAddress(s).then(() => "handled" as const);
      await pickZone(s, z.id);
      return "handled";
    }
    case "awaiting_address": {
      await setMode(s, { checkout_fulfillment_address: text.slice(0, 500) });
      await askNote(s);
      return "handled";
    }
    case "awaiting_fulfillment_note": {
      await finishAfterNote(s, text.slice(0, 500));
      return "handled";
    }
    case "awaiting_email": {
      const email = extractEmail(text);
      if (!email) return reply(s, s.m.emailHint, { force: true }).then(() => "handled" as const);
      try {
        s.customer = await setEmail(s.ctx, s.customer, email);
      } catch (e) {
        // Шаг остаётся «жду почту»: покупатель пришлёт её ещё раз.
        console.error(`[zernio:${s.ctx.tenant.id}] почта покупателя: ${String(e)}`);
        await reply(s, s.m.emailSaveFailed, { force: true });
        return "handled";
      }
      await setMode(s, { mode: "idle" });
      const cc = s.customer.state.country_code;
      if (!cc) return askCountry(s, true).then(() => "handled" as const);
      await finishCheckout(s, cc);
      return "handled";
    }
    case "awaiting_order_email": {
      const email = extractEmail(text);
      if (!email) return reply(s, s.m.emailHint, { force: true }).then(() => "handled" as const);
      await saveOrderEmail(s, Number(s.customer.state.pending_order_id), email);
      return "handled";
    }
    case "awaiting_proof":
    case "choose_pay":
    case "awaiting_payment": {
      if (isPaymentComplaint(text)) return "question";
      const rm = parseRemoveCommand(text);
      if (!rm && extractProductNumber(text) === null && !matchDirectCommand(text)) {
        // Вопрос по ходу оплаты — человеку, но напомним про чек (строгий
        // режим — один раз и только сразу после реквизитов).
        if (mayHint(s)) {
          s.hint = strict(s);
          await reply(s, s.m.sendReceiptPrompt);
        }
        return "question";
      }
      break;
    }
    default:
      break;
  }

  const remove = parseRemoveCommand(text);
  if (remove && inDialog(s)) {
    await removeFromCart(s, remove);
    return "handled";
  }

  const kind = classifyIncoming(text);
  switch (kind.kind) {
    case "phone": {
      // Номер — не коды товаров. Записали как контакт; ответ один раз и не поверх живой переписки продавца.
      const phone = normalizePhone(kind.digits);
      if (!phone) return "question";
      const saved = await noteChatPhone(s.ctx, s.customer, phone);
      s.customer = saved.customer;
      if (saved.fresh && !(await sellerWroteRecently(s)))
        await reply(s, s.m.phoneNoted, { force: true });
      return "handled";
    }
    case "product_number": {
      if (!s.bot.features.search) return "question";
      return (await pickByNumber(s, kind.number)) ? "handled" : "question";
    }
    case "product_numbers": {
      if (!s.bot.features.search) return "question";
      return (await pickSeveral(s, kind.numbers)) ? "handled" : "question";
    }
    case "affirmative": {
      // «Только по заказам»: «да» в переписке с продавцом бота не будит.
      if (!s.bot.features.catalog || s.bot.scope === "purchases") return "question";
      await showCatalog(s, null, 0, true);
      return "handled";
    }
    case "dismissal":
      // Разговор закрыт — не начинать его заново приветствием.
      return "handled";
    case "question":
      return "question";
  }
}

/**
 * Корзина из каталога Meta: позиции сопоставляются с товарами админки по
 * retailer id (id товара, номер или название). Совпало — в корзину и сразу к
 * оформлению; нет — продавцу в Telegram текстом, покупателю «передал».
 */
async function handleNativeCart(s: Shop, order: NativeOrder): Promise<ShopOutcome> {
  const { allActiveProducts } = await import("@/core/catalog/active");
  const products = await allActiveProducts<{ id: string; name: string; keywords: string | null }>(
    s.ctx,
    "id, name, keywords",
  );
  const match = matchNativeItems(order.items, products);
  const who = s.customer.username
    ? `@${s.customer.username}`
    : s.customer.firstName || s.customer.userKey;
  if (match.unmatched.length) {
    await notifyAdminsHtml(
      s.ctx,
      describeNativeCart(escapeHtml(who), match.unmatched, order.note) +
        (match.matched.length
          ? `\n\nОстальные позиции (${match.matched.map((m) => m.name).join(", ")}) бот положил в корзину покупателя.`
          : ""),
      { kind: "native_cart" },
    ).catch(() => 0);
  }
  if (!match.matched.length) {
    await reply(s, plain(s.m.nativeCartForwarded), { force: true });
    return "handled";
  }
  let added = 0;
  for (const m of match.matched)
    for (let i = 0; i < Math.min(m.quantity, 20); i++)
      if ((await addToCart(s.ctx, s.customer, m.productId)) === "ok") added++;
  if (!added) {
    await reply(s, plain(s.m.nativeCartForwarded), { force: true });
    return "handled";
  }
  // Покупатель увидит, что бот понял корзину, ещё до вопросов оформления.
  const card = await cartCard(s.ctx, s.customer, s.locale, s.inboundAt);
  if (card) await reply(s, card, { force: true });
  await startCheckout(s);
  return "handled";
}

/**
 * Голосовое, стикер, видео и фото вне оплаты (Б6). Консультант ИИ сам
 * разбирает такие сообщения — ему не мешаем. Голосовое/стикер/видео: в
 * разговоре с ботом один ответ «понимаю только текст» за 10 минут; в
 * обычной переписке с продавцом бот молчит (строгий режим). Фото, не
 * чек: продавцу в Telegram, покупателю — одно «передал».
 */
async function handleNonText(s: Shop, msg: ParsedZernioMessage): Promise<ShopOutcome> {
  const kind = nonTextKind(msg.attachments);
  if (!kind) return "question";
  const consultant = await import("@/core/consultant/engine.server");
  if (await consultant.consultantEnabled(s.ctx)) return "question";
  if (kind === "photo") {
    const { notifyAdminsHtml } = await import("@/channels/telegram/notify");
    const { sellerLocale } = await import("@/core/catalog/low-stock");
    const locale = await sellerLocale(s.ctx).catch(
      () => s.ctx.tenant.settings.default_locale ?? "ru",
    );
    const who = s.customer.username
      ? `@${s.customer.username}`
      : s.customer.firstName || s.customer.userKey;
    const urls = msg.attachments.map((a) => a.url).filter((u): u is string => Boolean(u));
    await notifyAdminsHtml(
      s.ctx,
      SELLER_PHOTO[locale](escapeHtml(who), PLATFORM_LABEL[s.platform]),
      { kind: "question", photos: urls.slice(0, 10) },
    ).catch(() => 0);
    if (inDialog(s) && (await claimNonTextReply(s)))
      await reply(s, PHOTO_FORWARDED[s.locale], { force: true });
    return "handled";
  }
  if (!inDialog(s)) return "question";
  if (await claimNonTextReply(s))
    await reply(s, TEXT_ONLY[s.locale], {
      force: true,
      buttons: [BTN.catalog(s.m), BTN.cart(s.m)],
    });
  return "handled";
}

/** Метка «ответили на не-текст» — условная запись до отправки: из двух вебхуков отвечает один. */
async function claimNonTextReply(s: Shop): Promise<boolean> {
  const claimed = await claimStateSection(s.ctx, s.customer, "direct", (cur) => {
    const at = Date.parse(String(cur.nontext_at ?? ""));
    if (Number.isFinite(at) && Date.now() - at < NON_TEXT_WINDOW_MS) return null;
    return { ...cur, nontext_at: new Date().toISOString() };
  });
  if (!claimed) return false;
  s.customer = claimed;
  return true;
}

/** Продавец вёл диалог руками за последние 30 минут. Не прочитали переписку — считаем, что нет. */
async function sellerWroteRecently(s: Shop): Promise<boolean> {
  try {
    const tail = await s.transport.tail(s.accountId, s.conversationId);
    const ours = memory(s.customer).last_reply;
    return sellerWroteWithin(tail, SELLER_ACTIVE_MS, ours ? [ours] : []);
  } catch (e) {
    console.warn(`[zernio-shop] переписка не прочитана ${s.customer.userKey}: ${String(e)}`);
    return false;
  }
}

/** Выключенная продавцом часть магазина: команда и кнопка не отвечают, реплика уходит как вопрос. */
function featureAllows(s: Shop, command: DirectCommand | string): boolean {
  const f = s.bot.features;
  switch (command) {
    case "catalog":
    case "CATALOG":
    case "CAT":
    case "PCAT":
    case "PROD":
      return f.catalog;
    case "cart":
    case "CART":
    case "BUY":
    case "CLEAR":
      return f.cart;
    case "checkout":
    case "CHECKOUT":
    case "PAY":
    case "FT":
    case "NOTE":
    case "GIFT":
    case "GIFTWRAP":
      return f.checkout;
    case "quiz":
    case "QUIZ":
      return s.ctx.tenant.modules.quiz && f.catalog;
    case "points":
      // Модуль лояльности выключен — слово не наше: реплика уходит продавцу.
      return s.ctx.tenant.modules.loyalty;
    default:
      return true;
  }
}

/**
 * Быстрый вопрос Instagram (core/instagram/ice-breakers) — первое нажатие в
 * новом диалоге. Ведёт на те же команды, что и слова «каталог», «мои
 * заказы». «Как оплатить» с пустой корзиной — способы оплаты (без
 * реквизитов: они — при оформлении). «Связаться с продавцом» — просьба
 * описать вопрос и метка: следующий вопрос handle-message отдаёт продавцу.
 */
async function handleIceBreaker(s: Shop, kind: IceBreakerKind): Promise<ShopOutcome> {
  if (kind === "contact") {
    await remember(s, { contact_requested_at: new Date().toISOString() });
    await reply(s, plain(s.m.ticketPrompt), { force: true });
    return "handled";
  }
  if (kind === "catalog") return openShop(s);
  const command: DirectCommand = kind === "pay" ? "checkout" : "orders";
  if (!featureAllows(s, command)) return "question";
  const mode = s.customer.state.mode;
  if (mode && mode !== "idle" && mode !== "awaiting_proof") await setMode(s, { mode: "idle" });
  if (command === "orders") {
    await showOrders(s);
    return "handled";
  }
  if ((await listCart(s.ctx, s.customer)).length > 0) {
    await startCheckout(s);
    return "handled";
  }
  const methods = await listActivePaymentMethods(s.ctx);
  if (!methods.length) {
    await reply(s, s.m.paymentNotConfigured, { force: true });
    return "handled";
  }
  const list = methods.map((x) => `• ${x.country_name} (${x.currency})`).join("\n");
  await reply(s, plain(s.m.payMethods(list)), { force: true, buttons: [BTN.catalog(s.m)] });
  return "handled";
}

/** Магазин с начала: язык новому покупателю, иначе каталог со сбросом шага. */
async function openShop(s: Shop): Promise<ShopOutcome> {
  if (!featureAllows(s, "catalog")) return "question";
  const mode = s.customer.state.mode;
  if (mode && mode !== "idle" && mode !== "awaiting_proof") await setMode(s, { mode: "idle" });
  if (await askCountryFirst(s, "catalog")) return "handled";
  await showCatalog(s, null, 0, true);
  return "handled";
}

/**
 * Страна — первым делом, чтобы цены в каталоге и карточке были в валюте
 * покупателя. Одна страна оплаты — ставим её молча; ни одной — не спрашиваем.
 * true — спросили, дальше покажет ответ на шаг (continueAfterCountry).
 */
async function askCountryFirst(s: Shop, then: string): Promise<boolean> {
  if (s.customer.state.country_code) return false;
  const methods = await listActivePaymentMethods(s.ctx);
  if (methods.length === 1) {
    await setMode(s, {
      country_code: methods[0]!.country_code,
      country_name: methods[0]!.country_name,
    });
    return false;
  }
  if (methods.length === 0) return false;
  await remember(s, { after_country: then });
  await askCountry(s, false);
  return true;
}

async function continueAfterCountry(s: Shop) {
  const then = memory(s.customer).after_country;
  if (!then) return;
  await remember(s, { after_country: undefined });
  if (then === "catalog") return showCatalog(s, null, 0, true);
  const id = then.startsWith("product:") ? then.slice("product:".length) : null;
  const p = id ? await getProduct(s.ctx, id) : null;
  if (p) await sendProductCard(s, p, true);
}

async function handlePostback(s: Shop, payload: string): Promise<ShopOutcome> {
  const [head, a, b, c] = payload.split(":");
  if (head && !featureAllows(s, head)) return "question";
  switch (head) {
    case "CATALOG":
      await showCatalog(s, null, 0, true);
      return "handled";
    case "CAT":
      // Смещение из постбэка: нет, не число или меньше нуля — начало списка.
      await showCatalog(s, a || null, Math.max(0, Math.floor(Number(b ?? 0)) || 0), true);
      return "handled";
    case "PCAT": {
      const offsetNow = Math.max(0, Math.floor(Number(b ?? 0)) || 0);
      await showCatalog(s, a || null, offsetNow, true, true);
      return "handled";
    }
    case "PROD": {
      const p = a ? await getProduct(s.ctx, a) : null;
      if (p) await sendProductCard(s, p, true);
      else await reply(s, s.m.productNotFound);
      return "handled";
    }
    case "BUY":
      // Четвёртая часть «u» — кнопка из «С этим берут»: добавление идёт в итоги допродажи.
      if (a) await addAndShowCart(s, a, b || null, c === "u");
      return "handled";
    case "CART":
      await showCart(s, true);
      return "handled";
    case "CLEAR":
      await clearCart(s.ctx, s.customer);
      await reply(s, s.m.cartCleared, { force: true, buttons: [BTN.catalog(s.m)] });
      return "handled";
    case "CHECKOUT":
      await startCheckout(s);
      return "handled";
    case "QUIZ":
      await startQuiz(s);
      return "handled";
    case "ORDERS":
      await showOrders(s);
      return "handled";
    case "WAIT": {
      if (!a || !s.ctx.tenant.modules.waitlist) return "question";
      const { joinWaitlist } = await import("@/core/waitlist/waitlist");
      s.customer = await joinWaitlist(s.ctx, s.customer, a);
      await reply(s, plain(s.m.waitlistJoined), { force: true, buttons: [BTN.catalog(s.m)] });
      return "handled";
    }
    case "REORDER": {
      const order = a ? await getOrder(s.ctx, Number(a)) : null;
      if (!order || order.telegram_id !== s.customer.telegramId) return "handled";
      const added = await reorderIntoCart(s.ctx, s.customer, order);
      if (!added) {
        await reply(s, plain(s.m.reorderNothing), { force: true, buttons: [BTN.catalog(s.m)] });
        return "handled";
      }
      await showCart(s, true, plain(s.m.reorderDone(added)));
      return "handled";
    }
    case "FT":
      if (a === "pickup" || a === "delivery") {
        await setMode(s, { checkout_fulfillment_type: a });
        await askFulfillmentDate(s);
      }
      return "handled";
    case "NOTE":
      await finishAfterNote(s, null);
      return "handled";
    case "EMAIL": {
      if (s.customer.state.mode !== "awaiting_email") return "handled";
      await remember(s, { email_skipped: true }, { mode: "idle" });
      const cc = s.customer.state.country_code;
      if (!cc) await askCountry(s, true);
      else await finishCheckout(s, cc);
      return "handled";
    }
    case "GIFTWRAP": {
      const cc = s.customer.state.country_code;
      if (s.customer.state.mode !== "awaiting_gift_wrap" || !cc) return "handled";
      await setMode(s, { mode: "idle", gift_wrap: a === "yes" });
      await finishCheckout(s, cc);
      return "handled";
    }
    case "GIFT": {
      const cc = s.customer.state.country_code;
      const mode = s.customer.state.mode;
      if (a === "skip") {
        if (mode !== "awaiting_gift_message") return "handled";
        await finishAfterGift(s, null);
        return "handled";
      }
      if (mode !== "awaiting_gift_choice" || !cc) return "handled";
      await afterGiftChoice(s, cc, a === "yes");
      return "handled";
    }
    case "LOYALTY": {
      const cc = s.customer.state.country_code;
      if (s.customer.state.mode !== "awaiting_points_choice" || !cc) return "handled";
      await setMode(s, { mode: "idle", use_points: a === "yes" });
      await finishCheckout(s, cc);
      return "handled";
    }
    case "PAY":
      await choosePayment(s, a === "rk" ? "rk" : "manual");
      return "handled";
    default:
      // Чужой postback (например, из comment-автоматизации Zernio) — не наш.
      return "question";
  }
}

// ── каталог ───────────────────────────────────────────────────────────

/** Пункт списка разделов: «товары самого раздела», когда у раздела есть и подразделы, и свои товары. */
const OWN_PRODUCTS_PREFIX = "~p:";
const OWN_PRODUCTS_LABEL: Record<Locale, string> = {
  ru: "Товары этого раздела",
  kk: "Осы бөлімнің тауарлары",
  en: "Products in this section",
  uz: "Shu bo‘lim mahsulotlari",
};

/** Открыть пункт списка разделов: подраздел или товары самого раздела. */
function openEntry(s: Shop, id: string) {
  return id.startsWith(OWN_PRODUCTS_PREFIX)
    ? showCatalog(s, id.slice(OWN_PRODUCTS_PREFIX.length), 0, true, true)
    : showCatalog(s, id, 0, true);
}

async function showCatalog(
  s: Shop,
  categoryId: string | null,
  offset: number,
  force: boolean,
  ownProductsOnly = false,
) {
  const children = ownProductsOnly ? [] : await listChildCategories(s.ctx, categoryId);
  // Раздел с подразделами и своими товарами: товары не теряем, а даём последним пунктом.
  const own =
    categoryId && children.length > 0 ? await listProductsInCategory(s.ctx, categoryId) : [];
  const cats = children.map((c) => ({ id: c.id, name: c.name }));
  if (categoryId && own.length > 0)
    cats.push({
      id: `${OWN_PRODUCTS_PREFIX}${categoryId}`,
      name: OWN_PRODUCTS_LABEL[s.locale] ?? OWN_PRODUCTS_LABEL.ru,
    });
  if (cats.length > 0) {
    const PAGE = pageSize(s);
    const page = cats.slice(offset, offset + PAGE);
    const lines = page.map((c, i) => `${offset + i + 1}. ${c.name}`);
    const more = cats.length > offset + PAGE;
    await remember(s, {
      list: {
        kind: "categories",
        ids: cats.slice(0, offset + PAGE).map((c) => c.id),
        at: new Date().toISOString(),
      },
    });
    const buttons: DmButton[] = [];
    if (more)
      buttons.push({
        type: "postback",
        title: plain(s.m.showMore),
        payload: `CAT:${categoryId ?? ""}:${offset + PAGE}`,
      });
    buttons.push(BTN.cart(s.m));
    // Корень каталога: подбор товара, если продавец настроил квиз (кнопок не больше трёх).
    if (!categoryId && s.ctx.tenant.modules.quiz && (await loadQuiz(s.ctx)).questions.length)
      buttons.push(BTN.quiz(s.m));
    if (categoryId)
      buttons.push({
        type: "postback",
        title: plain(s.m.backToCategories),
        payload: await backPayload(s, categoryId),
      });
    if (s.platform === "whatsapp") {
      await reply(s, plain(s.m.catalogHeader), {
        force,
        interactive: whatsappList({
          body: plain(s.m.catalogHeader),
          buttonLabel: plain(s.m.openCatalogBtn),
          sections: [
            {
              title: plain(s.m.catalogHeader),
              rows: page.map((c) => ({
                id: c.id.startsWith(OWN_PRODUCTS_PREFIX)
                  ? `PCAT:${c.id.slice(OWN_PRODUCTS_PREFIX.length)}:0`
                  : `CAT:${c.id}:0`,
                title: c.name,
              })),
            },
            { title: "…", rows: buttons.map((b) => ({ id: b.payload!, title: b.title })) },
          ],
        }),
      });
      return;
    }
    await reply(
      s,
      `${plain(s.m.catalogHeader)}\n\n${lines.join("\n")}\n\n${s.locale === "ru" ? "Напишите номер раздела." : plain(s.m.chooseSection)}`,
      { force, buttons: buttons.slice(0, 3) },
    );
    return;
  }
  const products = await listProductsInCategory(s.ctx, categoryId);
  if (products.length === 0) {
    await reply(s, s.m.emptyHere, { force, buttons: [BTN.catalog(s.m), BTN.cart(s.m)] });
    return;
  }
  await showProductList(s, products, offset, categoryId, force, ownProductsOnly);
}

async function showProductList(
  s: Shop,
  products: Product[],
  offset: number,
  categoryId: string | null,
  force: boolean,
  own = false,
) {
  // Товары раздела с подразделами: «ещё» остаётся в списке товаров, «назад» — в сам раздел.
  const pageHead = own ? "PCAT" : "CAT";
  const country = s.customer.state.country_code ?? null;
  const PAGE = pageSize(s);
  const page = products.slice(offset, offset + PAGE);
  const prices = await Promise.all(
    page.map(async (p) => {
      const variants = sortedVariants(p);
      const money = variants.length
        ? await resolvePrice(s.ctx, p, country, variants[0])
        : await resolvePrice(s.ctx, p, country);
      return variants.length
        ? plain(s.m.priceFrom(formatMoney(money.amount, money.currency)))
        : formatMoney(money.amount, money.currency);
    }),
  );
  const lines = page.map((p, i) => `${offset + i + 1}. ${p.name} — ${prices[i]}`);
  await remember(s, {
    list: {
      kind: "products",
      ids: products.slice(0, offset + PAGE).map((p) => p.id),
      at: new Date().toISOString(),
    },
  });
  const buttons: DmButton[] = [];
  if (products.length > offset + PAGE)
    buttons.push({
      type: "postback",
      title: plain(s.m.showMore),
      payload: `${pageHead}:${categoryId ?? ""}:${offset + PAGE}`,
    });
  buttons.push(BTN.cart(s.m));
  buttons.push(
    categoryId
      ? {
          type: "postback",
          title: plain(s.m.backToCategories),
          payload: own ? `CAT:${categoryId}:0` : await backPayload(s, categoryId),
        }
      : BTN.orders(s.m),
  );
  if (s.platform === "whatsapp") {
    await reply(s, plain(s.m.catalogHeader), {
      force,
      interactive: whatsappList({
        body: plain(s.m.catalogHeader),
        buttonLabel: plain(s.m.openCatalogBtn),
        sections: [
          {
            title: plain(s.m.catalog),
            rows: page.map((p, i) => ({
              id: `PROD:${p.id}`,
              title: p.name,
              description: rowSubtitle(p.name, prices[i] ?? ""),
            })),
          },
          { title: "…", rows: buttons.map((b) => ({ id: b.payload!, title: b.title })) },
        ],
      }),
    });
    return;
  }
  await reply(s, `${lines.join("\n")}\n\n${PRODUCT_LIST_HINT[s.locale]}`, {
    force,
    buttons: buttons.slice(0, 3),
  });
}

/**
 * «Назад» из раздела — к его родителю, а у раздела верхнего уровня — в
 * корень. Раньше всегда вёл в корень: из раздела второго уровня покупатель
 * терял место и начинал с начала.
 */
async function backPayload(s: Shop, categoryId: string): Promise<string> {
  const { data, error: readErr } = await s.ctx.db
    .from("categories")
    .select("parent_id")
    .eq("id", categoryId)
    .maybeSingle();
  if (readErr) throw serverFailure(`[zernio] категория не прочитана: ${readErr.message}`);
  return data?.parent_id ? `CAT:${data.parent_id}:0` : "CATALOG";
}

/** Список WhatsApp вмещает десять строк с навигацией; в Instagram — нумерованный текст. */
function pageSize(s: Shop): number {
  return s.platform === "whatsapp" ? WA_LIST_PAGE : PAGE;
}

/** Шаг сценария списком WhatsApp: строки «STEP:<n>» разбираются как набранная цифра. */
function stepList(body: string, buttonLabel: string, section: string, titles: string[]): Json {
  return whatsappList({
    body,
    buttonLabel,
    sections: [
      { title: section, rows: titles.map((title, i) => ({ id: `${STEP_PREFIX}${i + 1}`, title })) },
    ],
  });
}

/** Номер: из показанного списка, иначе — номер товара из названия/ключевых слов, иначе поиск. */
/** true — бот ответил; false — номер ни к чему не подошёл, а строгий режим промолчал. */
async function pickByNumber(s: Shop, number: string): Promise<boolean> {
  const mem = memory(s.customer);
  const list = mem.list;
  const listFresh = list && Date.now() - Date.parse(list.at) < LIST_TTL_MS;
  const n = Number(number);
  if (listFresh && list.kind !== "variants" && n >= 1 && n <= list.ids.length) {
    const id = list.ids[n - 1]!;
    if (list.kind === "categories") return openEntry(s, id).then(() => true);
    const p = await getProduct(s.ctx, id);
    if (p) return sendProductCard(s, p, true).then(() => true);
  }
  // Номер из поста: «018. Набор …» — ищем по началу названия и по ключевым словам.
  const padded = Array.from(new Set([number, number.padStart(2, "0"), number.padStart(3, "0")]));
  const candidates: Product[] = [];
  for (const q of padded) {
    for (const p of await searchProducts(s.ctx, q, 30)) {
      if (
        productNumberFromName(p.name) === number ||
        productNumberFromKeywords(p.keywords) === number
      )
        candidates.push(p);
    }
    if (candidates.length) break;
  }
  const p = candidates[0];
  if (p) {
    if (!(await askCountryFirst(s, `product:${p.id}`))) await sendProductCard(s, p, true);
    return true;
  }
  // Номер, которого нет в каталоге, в строгом режиме — обычная реплика («2» продавцу).
  if (!inDialog(s)) return false;
  await reply(s, `${plain(s.m.productNotFound)}\n\n${hint(s)}`, {
    buttons: [BTN.catalog(s.m), BTN.cart(s.m)],
  });
  return true;
}

/**
 * Несколько номеров одним сообщением («2 4 7», «2, 4, 7»). Ответ на список
 * разделов — открываем первый; на список товаров или коды — кладём в
 * корзину всё, что без выбора варианта, и показываем корзину.
 */
async function pickSeveral(s: Shop, numbers: string[]): Promise<boolean> {
  const list = memory(s.customer).list;
  const listFresh = list && Date.now() - Date.parse(list.at) < LIST_TTL_MS;
  if (listFresh && list.kind === "categories") {
    const idx = numbers.map(Number).find((n) => n >= 1 && n <= list.ids.length);
    if (idx) {
      await reply(s, ONE_SECTION_HINT[s.locale], { force: true });
      await openEntry(s, list.ids[idx - 1]!);
      return true;
    }
  }
  const found: Product[] = [];
  const missing: string[] = [];
  for (const number of numbers) {
    const n = Number(number);
    const fromList =
      listFresh && list.kind === "products" && n >= 1 && n <= list.ids.length
        ? await getProduct(s.ctx, list.ids[n - 1]!)
        : null;
    const p = fromList ?? (await productByCode(s, number));
    if (p && !found.some((x) => x.id === p.id)) found.push(p);
    else if (!p) missing.push(number);
  }
  if (found.length === 0) {
    if (!inDialog(s)) return false;
    await reply(s, `${plain(s.m.productNotFound)}\n\n${hint(s)}`, {
      buttons: [BTN.catalog(s.m), BTN.cart(s.m)],
    });
    return true;
  }
  const withVariants = found.filter((p) => sortedVariants(p).length > 0);
  let added = 0;
  const failed: string[] = [];
  for (const p of found.filter((x) => sortedVariants(x).length === 0)) {
    const r = await addToCart(s.ctx, s.customer, p.id, null);
    if (r === "ok") added++;
    else failed.push(p.name);
  }
  const copy = MULTI_ADD_COPY[s.locale];
  const notes = [
    missing.length ? copy.notFound(missing) : "",
    failed.length ? `${plain(s.m.unavailable).replace(/[.!]\s*$/, "")}: ${failed.join("; ")}` : "",
    withVariants.length ? copy.needsVariant(withVariants.map((p) => p.name)) : "",
  ].filter(Boolean);
  if (added === 0) {
    await reply(s, notes.join("\n") || plain(s.m.unavailable), {
      force: true,
      buttons: [BTN.cart(s.m), BTN.catalog(s.m)],
    });
    return true;
  }
  await showCart(s, true, [plain(s.m.added), ...notes].join("\n"));
  return true;
}

/** Товар по коду из названия или ключевых слов: «018. Набор …». */
async function productByCode(s: Shop, number: string): Promise<Product | null> {
  const padded = Array.from(new Set([number, number.padStart(2, "0"), number.padStart(3, "0")]));
  for (const q of padded) {
    for (const p of await searchProducts(s.ctx, q, 30))
      if (
        productNumberFromName(p.name) === number ||
        productNumberFromKeywords(p.keywords) === number
      )
        return p;
  }
  return null;
}

async function sendProductCard(s: Shop, p: Product, force: boolean) {
  const country = s.customer.state.country_code ?? null;
  const variants = sortedVariants(p);
  const imgs = sortedImages(p);
  // Нет в наличии, но продавец берёт предзаказ (core/preorder): кнопки покупки остаются.
  const { getPreorder } = await import("@/core/preorder/preorder");
  // Набор (модуль bundles): предзаказ и лист ожидания для него не предлагаем.
  const { bundleCardInfo, bundleCardLines } = await import("@/core/bundles/card");
  const bundle = await bundleCardInfo(s.ctx, p.id);
  // Остаток набора — по составляющим (core/bundles/stock), у остальных — свой.
  const stockedOut = bundle
    ? bundle.capacity === 0
    : s.ctx.tenant.modules.stock && p.stock_quantity != null && p.stock_quantity <= 0;
  const preorder = stockedOut && !bundle ? await getPreorder(s.ctx, p.id) : null;
  const outOfStock = stockedOut && !preorder;
  // Кнопок покупки нет: товара нет в наличии или в наборе недоступна составляющая.
  const noBuy = outOfStock || (bundle != null && !bundle.available);
  const desc = p.description ? `\n\n${p.description.slice(0, 600)}` : "";
  let text = `${p.name}${desc}`;
  const buttons: DmButton[] = [];
  let variantList: string[] = [];
  if (variants.length > 0) {
    const priced = await Promise.all(
      variants.map(async (v) => ({ v, money: await resolvePrice(s.ctx, p, country, v) })),
    );
    const min = Math.min(...priced.map((r) => r.money.amount));
    const currency = priced[0]?.money.currency ?? p.currency;
    text += `\n\n${plain(s.m.priceFrom(formatMoney(min, currency)))}`;
    if (!noBuy) {
      if (priced.length <= 2) {
        for (const { v, money } of priced)
          buttons.push({
            type: "postback",
            title: `${v.name} — ${formatMoney(money.amount, money.currency)}`.slice(0, 20),
            payload: `BUY:${p.id}:${v.id}`,
          });
      } else {
        variantList = priced.map(
          ({ v, money }, i) => `${i + 1}. ${v.name} — ${formatMoney(money.amount, money.currency)}`,
        );
        text += `\n\n${variantList.join("\n")}\n\n${s.locale === "ru" ? "Напишите номер варианта." : plain(s.m.chooseSection)}`;
      }
    }
  } else {
    const { price: money, old } = await strikePrice(s.ctx, p, country);
    // Директ без разметки: прежняя цена словами, «было … → стало …».
    text += `\n\n${old != null ? `${formatMoney(old, money.currency)} → ` : ""}${formatMoney(money.amount, money.currency)}`;
    if (!noBuy)
      buttons.push({ type: "postback", title: plain(s.m.addToCartBtn), payload: `BUY:${p.id}` });
  }
  if (outOfStock && !bundle && s.ctx.tenant.modules.waitlist)
    buttons.push({
      type: "postback",
      title: plain(s.m.waitlistBtn).slice(0, 20),
      payload: `WAIT:${p.id}`,
    });
  if (bundle) {
    text += `\n\n${bundleCardLines(bundle, s.locale).join("\n")}`;
  }
  const leadDays = shownLeadDays(p);
  if (leadDays) text += `\n${plain(s.m.leadTimeLabel(leadDays))}`;
  // Рейтинг — только одобренные отзывы, как на витрине (колонки products.rating_* считают все).
  const approved =
    s.ctx.tenant.modules.review_request && p.rating_count
      ? await (await import("@/core/reviews/photos.server")).approvedRating(s.ctx, p.id)
      : null;
  const rating = approved ? formatRatingSummary(approved.avg, approved.count) : null;
  if (rating) text += `\n${plain(rating)}`;
  if (preorder) text += `\n${plain(s.m.preorderLabel(preorder.from))}`;
  else if (outOfStock) text += `\n${plain(s.m.outOfStockLabel)}`;
  else if (s.ctx.tenant.modules.limited_offers) {
    const { offerForProductRow, offerLabel } = await import("@/core/offers/offers");
    const offer = await offerForProductRow(s.ctx, p);
    if (offer) text += `\n${offerLabel(offer, s.ctx.timezone, s.locale)}`;
  }
  // «Осталось N шт.» — только с согласия продавца и без предзаказа (core/catalog/low-stock).
  const { buyerLowStock } = await import("@/core/catalog/low-stock");
  const left = await buyerLowStock(s.ctx, p);
  if (left !== null) text += `\n${plain(s.m.lowStockLabel(left))}`;
  buttons.push(BTN.cart(s.m));
  if (buttons.length < 3) buttons.push(BTN.catalog(s.m));

  if (variantList.length) {
    await remember(
      s,
      {
        variant_product: p.id,
        list: { kind: "variants", ids: variants.map((v) => v.id), at: new Date().toISOString() },
      },
      { mode: "awaiting_variant_choice" },
    );
  }
  const attachmentUrl = await photoFor(
    s,
    imgs.map((i) => i.image_path),
  );
  await reply(s, text, { force, buttons: buttons.slice(0, 3), attachmentUrl });
}

// ── корзина ───────────────────────────────────────────────────────────

async function addAndShowCart(
  s: Shop,
  productId: string,
  variantId: string | null,
  fromUpsell = false,
) {
  const r = await addToCart(s.ctx, s.customer, productId, variantId);
  if (r === "ok" && fromUpsell) await recordEngage(s.ctx, "upsell_add", s.customer.telegramId);
  const msg: Record<typeof r, string> = {
    ok: s.m.added,
    unavailable: s.m.unavailable,
    mixed_cart: s.m.mixedCart,
    digital_limit: s.m.digitalLimit,
    out_of_stock: s.m.outOfStock,
    error: s.m.unavailable,
  };
  if (r !== "ok") {
    await reply(s, msg[r], { force: true, buttons: [BTN.cart(s.m), BTN.catalog(s.m)] });
    return;
  }
  await showCart(s, true, plain(s.m.added));
}

/**
 * Сводка корзины одной строкой — та же цена, что в оформлении (`cartSummary`:
 * скидки, баллы, сертификат). null — корзина пуста. Событие старше окна ответа
 * (повторная доставка вебхука) не отвечаем: сообщение всё равно не дойдёт.
 */
export async function cartCard(
  ctx: TenantContext,
  customer: Customer,
  locale: Locale,
  inboundAt: number | null = null,
): Promise<string | null> {
  if (inboundAt !== null && Date.now() - inboundAt > REPLY_WINDOW_MS) return null;
  const items = await listCart(ctx, customer);
  if (items.length === 0) return null;
  const st = customer.state;
  const priced = await priceCart(ctx, items, st.country_code ?? null);
  const sum = await cartSummary(ctx, customer, priced, {
    promoCode: st.promo_code,
    usePoints: st.use_points,
    giftCode: st.gift_certificate_code,
  });
  const count = items.reduce((n, i) => n + Number(i.quantity), 0);
  return cartCardText(locale, count, formatMoney(sum.total, sum.currency));
}

async function showCart(s: Shop, force: boolean, prefix?: string) {
  const items = await listCart(s.ctx, s.customer);
  if (items.length === 0) {
    await reply(s, s.m.cartEmpty, { force, buttons: [BTN.catalog(s.m)] });
    return;
  }
  const st = s.customer.state;
  const priced = await priceCart(s.ctx, items, st.country_code ?? null);
  const sum = await cartSummary(s.ctx, s.customer, priced, {
    promoCode: st.promo_code,
    usePoints: st.use_points,
    giftCode: st.gift_certificate_code,
  });
  let text = `${prefix ? `${prefix}\n\n` : ""}${plain(s.m.cartHeader)}`;
  const { preordersFor, activePreorder } = await import("@/core/preorder/preorder");
  const preorders = await preordersFor(
    s.ctx,
    priced.lines.map((l) => l.item.products!.id),
  );
  priced.lines.forEach((line, i) => {
    text += `${i + 1}. ${line.name} × ${line.item.quantity} — ${formatMoney(line.line, priced.currency)}\n`;
    const pre = activePreorder(
      s.ctx,
      line.item.products!,
      preorders.get(line.item.products!.id),
      Number(line.item.quantity),
    );
    if (pre) text += plain(s.m.preorderCartNote(pre.from));
  });
  if (sum.promo) text += plain(s.m.discountLine(formatMoney(sum.promo.discount, sum.currency)));
  if (sum.points.balance > 0) text += plain(s.m.pointsBalanceLine(sum.points.balance));
  if (sum.points.discount > 0) {
    const pts = formatMoney(sum.points.discount, sum.currency);
    text += plain(s.m.pointsDiscountLine(pts));
    if (sum.points.fx) text += plain(s.m.pointsFxLine(sum.points.spent, pts));
  }
  if (sum.gift)
    text += plain(s.m.giftCertificateDiscountLine(formatMoney(sum.gift.discount, sum.currency)));
  text += plain(s.m.total(formatMoney(sum.total, sum.currency)));
  const below = await belowMinimum(s.ctx, priced);
  if (below) text += plain(`${minOrderText(s.m, below)}\n`);
  const freeStatus = await (await freeDeliveryView(s.ctx, s.customer))?.forZone(null);
  if (freeStatus) text += plain(freeDeliveryText(s.m, freeStatus));
  if (s.locale === "ru") text += "\n\nУбрать позицию: «убрать 1».";
  await reply(s, text, { force, buttons: [BTN.checkout(s.m), BTN.catalog(s.m), BTN.clear(s.m)] });
  if (s.ctx.tenant.modules.upsell) {
    const { upsellFor } = await import("@/core/upsell/upsell");
    const offers = await upsellFor(
      s.ctx,
      priced.lines.map((l) => l.item.products?.id).filter((x): x is string => Boolean(x)),
    );
    if (offers.length) {
      const lines: string[] = [];
      for (const o of offers) {
        const money = await resolvePrice(s.ctx, o, st.country_code ?? null);
        lines.push(`• ${o.name} — ${formatMoney(money.amount, money.currency)}`);
      }
      await reply(s, `${plain(s.m.upsellHeader)}\n${lines.join("\n")}`, {
        force: true,
        buttons: offers.map((o) => ({
          type: "postback" as const,
          title: `➕ ${o.name}`.slice(0, 20),
          payload: `BUY:${o.id}::u`,
        })),
      });
    }
  }
}

async function removeFromCart(s: Shop, number: string) {
  const items = await listCart(s.ctx, s.customer);
  const idx = pickCartLineToRemove(
    number,
    items.map((i) => i.products?.name ?? ""),
  );
  if (idx === null) {
    await showCart(s, true);
    return;
  }
  await removeCartItem(s.ctx, s.customer, items[idx]!.id);
  await showCart(s, true);
}

// ── оформление ────────────────────────────────────────────────────────

async function askLocale(s: Shop) {
  await setMode(s, { mode: "awaiting_locale" });
  if (s.platform === "whatsapp") {
    const body = "Выберите язык / Тілді таңдаңыз / Tilni tanlang / Choose language";
    await reply(s, body, {
      force: true,
      interactive: stepList(
        body,
        "Язык / Language",
        "Язык / Language",
        SUPPORTED_LOCALES.map((l) => `${flags[l]} ${localeNames[l]}`),
      ),
    });
    return;
  }
  await reply(s, languagePickerText(), { force: true });
}

async function askCountry(s: Shop, forCheckout: boolean) {
  const methods = await listActivePaymentMethods(s.ctx);
  if (methods.length === 0) {
    await reply(s, s.m.paymentNotConfigured);
    return;
  }
  await setMode(s, { mode: "awaiting_country", placing_order: forCheckout ? true : undefined });
  const lines = methods.map((m, i) => `${i + 1}. ${m.country_name}`);
  if (s.platform === "whatsapp" && methods.length <= WA_LIST_MAX_ROWS) {
    await reply(s, plain(s.m.chooseCountry), {
      force: true,
      interactive: stepList(
        plain(s.m.chooseCountry),
        s.locale === "ru" ? "Выбрать страну" : plain(s.m.chooseCountry).slice(0, 20),
        plain(s.m.chooseCountry),
        methods.map((m) => m.country_name),
      ),
    });
    return;
  }
  await reply(s, `${plain(s.m.chooseCountry)}\n\n${lines.join("\n")}`, { force: true });
}

/**
 * Квиз-подбор (core/quiz): вопросы по одному, ответ — номер варианта (в WhatsApp
 * ещё строка списка). Подсчёт ответов и результат — в core/quiz, здесь только
 * показ: те же ответы дают тот же результат, что в Telegram и на сайте.
 */
async function startQuiz(s: Shop): Promise<void> {
  const quiz = await loadQuiz(s.ctx);
  if (!s.ctx.tenant.modules.quiz || !quiz.questions.length) {
    await reply(s, plain(s.m.quizNotReady), { force: true, buttons: [BTN.catalog(s.m)] });
    return;
  }
  await setMode(s, { mode: "awaiting_quiz", quiz_tags: [], quiz_q: 0 });
  if (quiz.intro) await reply(s, escapeHtml(quiz.intro), { force: true });
  await askQuizQuestion(s, quiz, 0);
}

async function askQuizQuestion(s: Shop, quiz: Quiz, q: number): Promise<void> {
  const question = quiz.questions[q]!;
  const head = `${q + 1}/${quiz.questions.length}. ${question.text}`;
  if (s.platform === "whatsapp") {
    await reply(s, head, {
      force: true,
      interactive: stepList(
        head,
        plain(s.m.quizPick),
        clipRowTitle(head),
        question.options.map((o) => clipRowTitle(o.label)),
      ),
    });
    return;
  }
  const lines = question.options.map((o, i) => `${i + 1}. ${o.label}`);
  await reply(s, `${head}\n\n${lines.join("\n")}\n\n${plain(s.m.quizDirectHint)}`, {
    force: true,
  });
}

async function finishQuiz(s: Shop, tags: string[]): Promise<void> {
  await setMode(s, { mode: "idle", quiz_tags: undefined, quiz_q: undefined });
  const found = await quizResult(s.ctx, tags);
  await recordEngage(s.ctx, "quiz_done", s.customer.telegramId);
  const products = (await Promise.all(found.map((p) => getProduct(s.ctx, p.id)))).filter(
    (p): p is Product => p !== null,
  );
  if (!products.length) {
    await reply(s, plain(s.m.quizNothing), { force: true, buttons: [BTN.catalog(s.m)] });
    return;
  }
  await reply(s, plain(s.m.quizResult), { force: true });
  await showProductList(s, products, 0, null, true);
}

async function startCheckout(s: Shop) {
  if ((await cartCount(s.ctx, s.customer)) === 0) {
    await reply(s, s.m.cartEmpty, { force: true, buttons: [BTN.catalog(s.m)] });
    return;
  }
  await continueCheckout(s);
}

async function continueCheckout(s: Shop) {
  const items = await listCart(s.ctx, s.customer);
  const physical = items.some((i) => i.products?.fulfillment_kind === "physical");
  // Телефон нужен только для физического заказа: цифровой выдаётся сюда же, в переписку.
  if (physical && !s.customer.contactPhone) {
    await setMode(s, { mode: "awaiting_contact" });
    await reply(s, s.m.phonePromptHtml, { force: true });
    return;
  }
  if (!s.customer.state.country_code) return askCountry(s, true);
  return proceedToFulfillmentOrPlace(s, s.customer.state.country_code);
}

async function proceedToFulfillmentOrPlace(s: Shop, countryCode: string) {
  const items = await listCart(s.ctx, s.customer);
  const physical = items.some((i) => i.products?.fulfillment_kind === "physical");
  const {
    checkout_fulfillment_type: _t,
    checkout_fulfillment_at: _a,
    checkout_delivery_zone_id: _z,
    checkout_delivery_zone_name: _zn,
    checkout_delivery_fee: _zf,
    checkout_fulfillment_address: _ad,
    checkout_fulfillment_note: _n,
    // Ответ «списать баллы?» — на одно оформление: новое спросит заново.
    use_points: _p,
    ...clean
  } = s.customer.state;
  if (!physical) {
    s.customer = await setState(s.ctx, s.customer, clean);
    return proceedToLanguageOrPlace(s, countryCode);
  }
  const fs = await fulfillmentSettings(s.ctx);
  if (fs.pickup && fs.delivery) {
    s.customer = await setState(s.ctx, s.customer, { ...clean, mode: "awaiting_fulfillment_type" });
    await reply(s, s.m.fulfillmentTypePrompt, {
      force: true,
      buttons: [
        { type: "postback", title: plain(s.m.fulfillmentTypePickupBtn), payload: "FT:pickup" },
        { type: "postback", title: plain(s.m.fulfillmentTypeDeliveryBtn), payload: "FT:delivery" },
      ],
    });
    return;
  }
  s.customer = await setState(s.ctx, s.customer, {
    ...clean,
    checkout_fulfillment_type: fs.delivery ? "delivery" : "pickup",
  });
  return askFulfillmentDate(s);
}

async function askFulfillmentDate(s: Shop) {
  const rules = await closedRules(s.ctx);
  const minIso = await earliestFulfillmentDate(s.ctx, s.customer, rules);
  await setMode(s, { mode: "awaiting_fulfillment_date", checkout_min_fulfillment_date: minIso });
  const note = hasClosedDays(rules)
    ? `\n${s.m.fulfillmentClosedNote(describeClosed(rules, s.locale))}`
    : "";
  await reply(s, s.m.fulfillmentDatePrompt(isoToDisplay(minIso)) + note, { force: true });
}

async function afterDate(s: Shop) {
  // Слоты магазина (core/fulfillment/slots): после даты — время нумерованным списком.
  const at = s.customer.state.checkout_fulfillment_at ?? "";
  if (at && !at.includes("T")) {
    const { fulfillmentSlots } = await import("@/core/fulfillment/slots");
    const free = await freeSlotsOnDate(s.ctx, at);
    if ((await fulfillmentSlots(s.ctx)).length && free.length === 0) {
      // Все слоты дня разобрали, пока покупатель выбирал: назад к дате.
      await reply(s, s.m.fulfillmentDateFull(null), { force: true });
      return askFulfillmentDate(s);
    }
    const slots = free;
    if (slots.length) {
      await setMode(s, { mode: "awaiting_fulfillment_slot" });
      const lines = slots.map((x, i) => `${i + 1}. ${x}`).join("\n");
      await reply(s, `${plain(s.m.fulfillmentSlotPrompt)}\n\n${lines}`, { force: true });
      return;
    }
  }
  if (s.customer.state.checkout_fulfillment_type === "delivery") return askZoneOrAddress(s);
  return askNote(s);
}

async function askZoneOrAddress(s: Shop) {
  const zones = await activeDeliveryZones(s.ctx);
  if (zones.length === 0) {
    await setMode(s, { mode: "awaiting_address" });
    await reply(s, s.m.addressPrompt, { force: true });
    return;
  }
  await setMode(s, { mode: "awaiting_delivery_zone" });
  const view = await freeDeliveryView(s.ctx, s.customer);
  const lines = await Promise.all(
    zones.map(async (z, i) => {
      const fee = await zoneFee(s.ctx, z.price, s.customer.state.country_code);
      const free = (await view?.forZone(z.id))?.free ?? false;
      return `${i + 1}. ${z.name} (${free ? s.m.freeWord : `+${formatMoney(fee.amount, fee.currency)}`})`;
    }),
  );
  await reply(s, `${plain(s.m.deliveryZonePrompt)}\n\n${lines.join("\n")}`, { force: true });
}

async function pickZone(s: Shop, zoneId: string) {
  const zone = (await activeDeliveryZones(s.ctx)).find((z) => z.id === zoneId);
  if (!zone) return askZoneOrAddress(s);
  const fee = await zoneFee(s.ctx, zone.price, s.customer.state.country_code);
  await setMode(s, {
    checkout_delivery_zone_id: zone.id,
    checkout_delivery_zone_name: zone.name,
    checkout_delivery_fee: fee.amount,
    mode: "awaiting_address",
  });
  await reply(s, s.m.addressPrompt, { force: true });
}

async function askNote(s: Shop) {
  await setMode(s, { mode: "awaiting_fulfillment_note" });
  await reply(s, s.m.fulfillmentNotePrompt, {
    force: true,
    buttons: [{ type: "postback", title: plain(s.m.fulfillmentNoteSkipBtn), payload: "NOTE:skip" }],
  });
}

async function finishAfterNote(s: Shop, note: string | null) {
  await setMode(s, { checkout_fulfillment_note: note ?? undefined, mode: "idle" });
  const cc = s.customer.state.country_code;
  if (!cc) return askCountry(s, true);
  return finishCheckout(s, cc);
}

/** Язык материалов до оформления — списком: языки корзины, затем «все языки ×N». */
async function proceedToLanguageOrPlace(s: Shop, countryCode: string) {
  if (await askDeliveryLangBeforeOrder(s.ctx)) {
    const langs = await cartLanguageChoices(s.ctx, s.customer);
    if (langs.length > 1) {
      await setMode(s, { mode: "awaiting_delivery_lang", delivery_lang: undefined });
      const titles = langs.map((l) => `${flags[l]} ${localeNames[l]}`);
      titles.push(plain(s.m.allLanguagesBtn(langs.length)));
      if (s.platform === "whatsapp") {
        await reply(s, plain(s.m.chooseDeliveryLanguage), {
          force: true,
          interactive: stepList(
            plain(s.m.chooseDeliveryLanguage),
            plain(s.m.chooseDeliveryLanguage),
            plain(s.m.chooseDeliveryLanguage),
            titles,
          ),
        });
        return;
      }
      const lines = titles.map((t, i) => `${i + 1}. ${t}`);
      await reply(s, `${plain(s.m.chooseDeliveryLanguage)}\n\n${lines.join("\n")}`, {
        force: true,
      });
      return;
    }
  }
  return finishCheckout(s, countryCode);
}

/**
 * Шаг «ваша почта» до оформления (перенос из v1): заказ из Instagram
 * выдаётся письмом, и почта нужна до чека — автопроверка чека выдаёт заказ
 * сразу. Спросили — true, оформление продолжит ответ покупателя.
 */
async function askEmailFirst(s: Shop, countryCode: string): Promise<boolean> {
  const items = await listCart(s.ctx, s.customer);
  const step = emailStep({
    platform: s.platform,
    physical: items.some((i) => i.products?.fulfillment_kind === "physical"),
    knownEmail: s.customer.email,
    skipped: memory(s.customer).email_skipped === true,
    mailReady: (s.transport.mailReady ?? isMailConfigured)(),
  });
  if (!step) return false;
  await setMode(s, { mode: "awaiting_email", country_code: countryCode });
  if (step === "required") await reply(s, s.m.emailAsk, { force: true });
  else
    await reply(s, s.m.emailAskOptional, {
      force: true,
      buttons: [{ type: "postback", title: plain(s.m.emailSkipBtn), payload: "EMAIL:skip" }],
    });
  return true;
}

/**
 * Почта, присланная после чека: в покупателя и в заказ. Если продавец уже
 * выдал заказ — письмо уходит сразу, иначе его отправит выдача.
 */
async function saveOrderEmail(s: Shop, orderId: number, email: string) {
  try {
    if (orderId) await setOrderEmail(s.ctx, orderId, s.customer.telegramId, email);
    s.customer = await setEmail(s.ctx, s.customer, email);
  } catch (e) {
    // Не говорим «записал», если не записали: шаг остаётся, покупатель пришлёт почту ещё раз.
    console.error(`[zernio:${s.ctx.tenant.id}] почта заказа #${orderId}: ${String(e)}`);
    await reply(s, s.m.emailSaveFailed, { force: true });
    return;
  }
  await setMode(s, { mode: "idle" });
  if (orderId) {
    const fresh = await getOrder(s.ctx, orderId);
    if (fresh?.status === "delivered") {
      const { emailOrderMaterials } = await import("@/core/orders/email");
      await emailOrderMaterials(s.ctx, fresh).catch((e) =>
        console.warn(`[zernio] письмо по заказу #${orderId}: ${String(e)}`),
      );
    }
  }
  await reply(s, s.m.emailSaved(email), { force: true });
}

/** После чека: заказу из Instagram без почты — спросить её (заказ мог прийти из v1 или до шага). */
async function askOrderEmailIfMissing(s: Shop, order: OrderWithItems): Promise<boolean> {
  if (
    s.platform !== "instagram" ||
    order.fulfillment_kind === "physical" ||
    order.customer_email?.trim() ||
    !(s.transport.mailReady ?? isMailConfigured)()
  )
    return false;
  await setMode(s, { mode: "awaiting_order_email", pending_order_id: order.id });
  return true;
}

/**
 * Шаг «списать баллы?» (перенос из v1 direct-flow): в Direct нет кнопки
 * корзины «Списать баллы», поэтому при модуле loyalty и ненулевом балансе
 * спрашиваем один раз за оформление. Ответ — в use_points (false — копить).
 */
async function askPointsFirst(s: Shop, countryCode: string): Promise<boolean> {
  if (!s.ctx.tenant.modules.loyalty || s.customer.loyaltyPoints <= 0) return false;
  if (s.customer.state.use_points !== undefined) return false;
  await setMode(s, { mode: "awaiting_points_choice", country_code: countryCode });
  await askPoints(s);
  return true;
}

async function askPoints(s: Shop) {
  await reply(s, plain(s.m.pointsAsk(s.customer.loyaltyPoints)), {
    force: true,
    buttons: [
      { type: "postback", title: plain(s.m.pointsYesBtn), payload: "LOYALTY:yes" },
      { type: "postback", title: plain(s.m.pointsNoBtn), payload: "LOYALTY:no" },
    ],
  });
}

/**
 * Шаг «это подарок?» (модуль bundles): в Direct нет кнопки корзины, поэтому
 * спрашиваем один раз за оформление. «Да» — имя получателя и текст открытки.
 */
async function askGiftFirst(s: Shop, countryCode: string): Promise<boolean> {
  if (!s.ctx.tenant.modules.bundles || s.customer.state.gift_asked) return false;
  // Вопрос задаётся каждому покупателю — только если продавец его включил.
  const { giftAskOn } = await import("@/core/orders/gift");
  if (!(await giftAskOn(s.ctx))) return false;
  // Подарок — для физического заказа: цифровой товар упаковывать и вручать нечему.
  if (!(await physicalCart(s, countryCode))) return false;
  await setMode(s, { mode: "awaiting_gift_choice", country_code: countryCode, gift_asked: true });
  await askGift(s);
  return true;
}

/** Корзина физическая: подарок и упаковка предлагаются только таким заказам. */
async function physicalCart(s: Shop, countryCode: string): Promise<boolean> {
  const items = await listCart(s.ctx, s.customer);
  if (items.length === 0) return false;
  return (await priceCart(s.ctx, items, countryCode)).kind === "physical";
}

async function askGift(s: Shop) {
  await reply(s, plain(s.m.giftAsk), {
    force: true,
    buttons: [
      { type: "postback", title: plain(s.m.giftYesBtn), payload: "GIFT:yes" },
      { type: "postback", title: plain(s.m.giftNoBtn), payload: "GIFT:no" },
    ],
  });
}

async function afterGiftChoice(s: Shop, countryCode: string, yes: boolean) {
  if (!yes) {
    await setMode(s, { mode: "idle", gift_reask: undefined });
    return finishCheckout(s, countryCode);
  }
  await setMode(s, { mode: "awaiting_gift_recipient", gift_on: true, gift_reask: undefined });
  await reply(s, plain(s.m.giftRecipientPrompt), { force: true });
}

async function askGiftMessage(s: Shop) {
  await reply(s, plain(s.m.giftMessagePrompt), {
    force: true,
    buttons: [{ type: "postback", title: plain(s.m.giftSkipBtn), payload: "GIFT:skip" }],
  });
}

async function finishAfterGift(s: Shop, message: string | null) {
  await setMode(s, { gift_message: message ?? undefined, mode: "idle" });
  const cc = s.customer.state.country_code;
  if (!cc) return askCountry(s, true);
  // Подарочная упаковка — если продавец её включил и заказ физический.
  if (await giftWrapPrice(s, cc)) return askGiftWrap(s);
  return finishCheckout(s, cc);
}

/** Цена упаковки для корзины (в её валюте) или null — предлагать нечего. */
async function giftWrapPrice(s: Shop, countryCode: string) {
  const items = await listCart(s.ctx, s.customer);
  if (items.length === 0) return null;
  const priced = await priceCart(s.ctx, items, countryCode);
  const fee = await giftWrapForCart(s.ctx, priced);
  return fee > 0 ? { fee, currency: priced.currency } : null;
}

async function askGiftWrap(s: Shop) {
  const cc = s.customer.state.country_code ?? "";
  const price = await giftWrapPrice(s, cc);
  if (!price) return finishCheckout(s, cc);
  await setMode(s, { mode: "awaiting_gift_wrap" });
  await reply(s, plain(s.m.giftWrapAsk(formatMoney(price.fee, price.currency))), {
    force: true,
    buttons: [
      { type: "postback", title: plain(s.m.giftWrapYesBtn), payload: "GIFTWRAP:yes" },
      { type: "postback", title: plain(s.m.giftWrapNoBtn), payload: "GIFTWRAP:no" },
    ],
  });
}

async function finishCheckout(s: Shop, countryCode: string) {
  if (await askEmailFirst(s, countryCode)) return;
  if (await askPointsFirst(s, countryCode)) return;
  if (await askGiftFirst(s, countryCode)) return;
  const st = s.customer.state;
  const result = await placeOrder(s.ctx, s.customer, countryCode, {
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
        return void (await reply(s, s.m.checkoutBusy));
      case "empty_cart":
        return void (await reply(s, s.m.cartEmpty, { buttons: [BTN.catalog(s.m)] }));
      case "country_unavailable":
        await reply(s, s.m.countryNoLongerAvailable, { force: true });
        return askCountry(s, true);
      case "promo_invalid":
      case "promo_used": {
        const { promo_code: _pc, ...rest } = st;
        s.customer = await setState(s.ctx, s.customer, rest);
        return void (await reply(
          s,
          result.reason === "promo_used" ? s.m.promoCodeUsed : s.m.promoCodeInvalid,
        ));
      }
      case "discount_fx":
        return void (await reply(s, s.m.discountFx));
      case "mixed_currency":
        return void (await reply(s, s.m.mixedCurrency));
      case "gift_invalid": {
        const { gift_certificate_code: _gc, ...rest } = st;
        s.customer = await setState(s.ctx, s.customer, rest);
        return void (await reply(s, s.m.giftCertificateInvalid));
      }
      case "gift_wrap_unavailable": {
        const { gift_wrap: _gw, ...rest } = st;
        s.customer = await setState(s.ctx, s.customer, rest);
        return void (await reply(s, s.m.giftWrapUnavailable));
      }
      case "out_of_stock":
        return void (await reply(s, s.m.outOfStockAtCheckout));
      case "day_full":
        await reply(s, s.m.orderDayTaken, { force: true });
        return askFulfillmentDate(s);
      case "slot_taken": {
        await reply(s, s.m.orderSlotTaken, { force: true });
        // Дата та же, время выбрать заново.
        await setMode(s, { checkout_fulfillment_at: st.checkout_fulfillment_at?.slice(0, 10) });
        return afterDate(s);
      }
      case "below_min":
        return void (await reply(s, minOrderText(s.m, result)));
      default:
        return void (await reply(s, s.m.orderCreateFailed));
    }
  }
  const { order, method } = result;
  const no = displayNo(order);
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
  } = s.customer.state;
  if (result.giftRest)
    await reply(
      s,
      s.m.giftRestIssued(
        result.giftRest.code,
        formatMoney(result.giftRest.amount, result.giftRest.currency),
      ),
      { force: true },
    );
  const physical = order.fulfillment_kind === "physical";
  const api = adminTelegramApi(s.ctx);
  const notifyAdmin = async (
    o: OrderWithItems,
    opts: Parameters<typeof import("@/channels/telegram/admin-notify").notifyAdminNewOrder>[4] = {},
  ) => {
    if (!api) return;
    const { notifyAdminNewOrder } = await import("@/channels/telegram/admin-notify");
    await notifyAdminNewOrder(s.ctx, api, o, null, opts);
  };
  if (physical && result.amountDue <= 0 && !result.zeroTotal) {
    await s.ctx.db
      .from("orders")
      .update({ status: "accepted" })
      .eq("id", order.id)
      .eq("status", "awaiting_payment");
    s.customer = await setState(s.ctx, s.customer, { ...rest, mode: "idle" });
    await reply(s, s.m.orderAcceptedOnReceipt(no, formatMoney(order.total, order.currency)), {
      force: true,
    });
    await notifyAdmin(order);
    return;
  }
  if (result.zeroTotal) {
    s.customer = await setState(s.ctx, s.customer, { ...rest, mode: "idle" });
    await reply(s, s.m.orderPaidByDiscounts(no), { force: true });
    if (physical) {
      await s.ctx.db
        .from("orders")
        .update({ status: "accepted" })
        .eq("id", order.id)
        .eq("status", "awaiting_payment");
    } else {
      await deliverHere(s, order.id, no);
    }
    await notifyAdmin(order);
    return;
  }
  const due = result.amountDue;
  const rk = await robokassaFor(s.ctx, order.currency);
  if (rk.ready) {
    s.customer = await setState(s.ctx, s.customer, {
      ...rest,
      mode: "choose_pay",
      pending_order_id: order.id,
      pending_display_no: no,
    });
    await reply(
      s,
      `${plain(s.m.manualTitleNew(no))}\n\n${plain(s.m.amountToPay(formatMoney(due, order.currency)))}\n\n${plain(s.m.choosePayMethod)}`,
      {
        force: true,
        buttons: [
          { type: "postback", title: plain(s.m.payViaRobokassaBtn), payload: "PAY:rk" },
          { type: "postback", title: plain(s.m.payManualBtn), payload: "PAY:manual" },
        ],
      },
    );
    return;
  }
  s.customer = await setState(s.ctx, s.customer, {
    ...rest,
    mode: "awaiting_proof",
    pending_order_id: order.id,
    pending_display_no: no,
  });
  const depositLine =
    physical && due < Number(order.total)
      ? `${plain(s.m.depositLine(formatMoney(due, order.currency), formatMoney(order.total, order.currency)))}\n\n`
      : "";
  await sendManualInstructions(s, {
    no,
    due,
    currency: order.currency,
    instructions: method.instructions,
    qr: method.qr_code_path,
    physical,
    depositLine,
  });
}

async function sendManualInstructions(
  s: Shop,
  p: {
    no: number;
    due: number;
    currency: string;
    instructions: string | null;
    qr: string | null;
    physical: boolean;
    depositLine: string;
  },
) {
  const text =
    `${plain(s.m.manualTitleNew(p.no))}\n\n${plain(s.m.amountToPay(formatMoney(p.due, p.currency)))}\n${p.depositLine}\n` +
    `${p.instructions || plain(s.m.defaultInstructions)}\n\n${plain(p.physical ? s.m.afterProofPhysical : s.m.afterProofManual)}`;
  await reply(s, text, { force: true, attachmentUrl: await photoFor(s, [p.qr]) });
}

async function choosePayment(s: Shop, kind: "rk" | "manual") {
  const orderId = Number(s.customer.state.pending_order_id);
  const order = orderId ? await getOrder(s.ctx, orderId) : null;
  if (!order || order.telegram_id !== s.customer.telegramId || order.status !== "awaiting_payment")
    return;
  const no = displayNo(order);
  const due = await amountDueNow(s.ctx, {
    total: Number(order.total),
    fulfillment_kind: order.fulfillment_kind,
  });
  if (kind === "rk") {
    const rk = await robokassaFor(s.ctx, order.currency);
    if (!rk.ready) return;
    const url = buildPaymentUrl(rk, {
      outSum: due,
      invId: order.id,
      description: `Заказ #${no}`,
      botId: s.ctx.tenant.id,
      receipt: robokassaReceipt(rk, order, due, `Заказ #${no}`),
    });
    await setMode(s, {
      mode: "awaiting_payment",
      pending_order_id: order.id,
      pending_display_no: no,
    });
    await reply(
      s,
      `${plain(s.m.manualTitleNew(no))}\n\n${plain(s.m.amountToPay(formatMoney(due, order.currency)))}\n\n${plain(s.m.robokassaHint)}\n\n${url}`,
      { force: true, buttons: [{ type: "url", title: plain(s.m.payViaRobokassaBtn), url }] },
    );
    return;
  }
  const method =
    (await listActivePaymentMethods(s.ctx)).find((x) => x.country_code === order.country_code) ??
    null;
  const physical = order.fulfillment_kind === "physical";
  await setMode(s, { mode: "awaiting_proof", pending_order_id: order.id, pending_display_no: no });
  await sendManualInstructions(s, {
    no,
    due,
    currency: order.currency,
    instructions: method?.instructions ?? null,
    qr: method?.qr_code_path ?? null,
    physical,
    depositLine:
      physical && due < Number(order.total)
        ? `${plain(s.m.depositLine(formatMoney(due, order.currency), formatMoney(order.total, order.currency)))}\n\n`
        : "",
  });
}

// ── чек и выдача ──────────────────────────────────────────────────────

async function receiveProof(
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
    const text =
      res.reason === "duplicate"
        ? s.m.proofDuplicate
        : res.reason === "closed" || res.reason === "not_found"
          ? s.m.proofOrderClosed
          : res.reason === "invalid_file"
            ? s.m.proofBadFile
            : res.reason === "file_too_large"
              ? s.m.proofTooLarge
              : s.m.proofFailed;
    await reply(s, text, { force: true });
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

  const { receiptOcrAutoEnabled } = await import("@/core/receipts/verify.server");
  if (res.order.fulfillment_kind !== "physical" && (await receiptOcrAutoEnabled(s.ctx))) {
    const { verifyCustomerReceipt } = await import("@/core/receipts/verify.server");
    const { isRetryReason } = await import("@/core/receipts/pure");
    const checked = await verifyCustomerReceipt(s.ctx, s.customer, {
      bytes: file.bytes,
      mime,
      expectedAmount: Number(res.order.total),
      currency: res.order.currency,
      orderId,
      recipientCountry: res.order.country_code,
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
    await setMode(s, { mode: "idle" });
    if (!v.ok) {
      await s.ctx.db
        .from("orders")
        .update({ admin_note: `OCR: ${v.detail}`.slice(0, 500) })
        .eq("id", orderId);
      await reply(s, s.m.receiptManualReview(String(no)), { force: true });
      if (await askOrderEmailIfMissing(s, res.order)) await reply(s, s.m.emailAsk, { force: true });
      await notifyAdmin(res.order, { reviewReason: v.detail });
      return;
    }
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
    return;
  }

  await setMode(s, { mode: "idle" });
  if (await askOrderEmailIfMissing(s, res.order)) {
    await reply(s, s.m.proofReceivedNeedEmail(no), { force: true });
    await notifyAdmin(res.order);
    return;
  }
  const email =
    orderChannel(res.order.platform) !== "telegram" ? res.order.customer_email?.trim() : null;
  await reply(s, email ? s.m.proofReceivedEmail(no, email) : s.m.proofReceived(no), {
    force: true,
    buttons: [BTN.orders(s.m), BTN.catalog(s.m)],
  });
  await notifyAdmin(res.order);
}

/** Выдача цифрового заказа ссылками в эту же переписку. */
async function deliverHere(s: Shop, orderId: number, no: number): Promise<boolean> {
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

async function showOrders(s: Shop) {
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
async function showPoints(s: Shop) {
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

export const __test = { fingerprint, env };
