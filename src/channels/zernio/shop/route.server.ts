import { nonceFromMessage } from "@/core/storefront/code-login";
import { explainIncoming } from "../reason";
import { lastPaidOrder, shortLabels } from "@/core/orders/reorder";
import {
  nonTextKind,
  NON_TEXT_WINDOW_MS,
  PHOTO_FORWARDED,
  SELLER_PHOTO,
  TEXT_ONLY,
} from "../nontext";
import { sellerWroteWithin } from "../manager-guard";
import type { TenantContext } from "@/core/tenant/resolve.server";
import {
  setContactPhone,
  noteChatPhone,
  claimStateSection,
  setEmail,
  type Customer,
} from "@/core/customers/customers";
import { getProduct } from "@/core/catalog/catalog";
import { addToCart, clearCart, listCart } from "@/core/cart/cart";
import {
  getOrder,
  listActivePaymentMethods,
  recentAwaitingPaymentOrder,
  type OrderWithItems,
  reorderReport,
} from "@/core/orders/orders";
import { GIFT_MESSAGE_MAX, GIFT_NAME_MAX, normalizeGift } from "@/core/orders/gift";
import {
  activeDeliveryZones,
  checkFulfillmentDate,
  earliestFulfillmentDate,
} from "@/core/fulfillment/fulfillment";
import { closedRules } from "@/core/fulfillment/closed-days";
import { dateAvailability, freeSlotsOnDate } from "@/core/fulfillment/capacity";
import { isoToDisplay, parseDateInput } from "@/core/fulfillment/pure";
import { parseRatingReply } from "@/core/reviews/ask";
import { loadQuiz, quizAnswer } from "@/core/quiz/quiz";
import { hasDeliveredPurchase, saveRating } from "@/core/reviews/reviews";
import { REPLY_WINDOW_MS } from "@/core/chat/reply-window";
import { cartLanguageChoices } from "@/core/cart/languages";
import { COPY, escapeHtml, normalizePhone } from "@/channels/telegram/copy";
import { notifyAdminsHtml } from "@/channels/telegram/notify";
import { liveTransport, type ZernioTransport } from "../api.server";
import type { NativeOrder, ParsedZernioMessage } from "../message";
import { describeNativeCart, matchNativeItems } from "@/core/whatsapp/native-cart";
import { PLATFORM_LABEL } from "../platform";
import {
  classifyIncoming,
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
  stepAnswer,
  isStepStale,
  matchOrdinal,
  matchZone,
  parseRemoveCommand,
  pickReceiptAttachment,
  plain,
} from "../shop-flow";
import { matchFulfillmentType } from "@/core/fulfillment/pure";
import {
  DEFAULT_DIRECT_BOT,
  isStartPostback,
  isTriggerWord,
  type DirectBotSettings,
} from "@/core/instagram/direct-bot-settings";
import { iceBreakerKind, type IceBreakerKind } from "@/core/instagram/ice-breakers";
import {
  BTN,
  SELLER_ACTIVE_MS,
  type Shop,
  type ShopOutcome,
  hint,
  inDialog,
  localeOf,
  mayHint,
  memory,
  remember,
  reply,
  setMode,
  stepAnswerFits,
  strict,
} from "./context.server";
import {
  pickByNumber,
  pickByTag,
  pickSeveral,
  sendProductCard,
  showCatalog,
} from "./catalog.server";
import { addAndShowCart, cartCard, removeFromCart, showCart } from "./cart.server";
import {
  afterDate,
  afterGiftChoice,
  askCountry,
  askFulfillmentDate,
  askGift,
  askGiftMessage,
  askGiftWrap,
  askLocale,
  askNote,
  askPoints,
  askQuizQuestion,
  askZoneOrAddress,
  choosePayment,
  continueCheckout,
  finishAfterGift,
  finishAfterNote,
  finishCheckout,
  finishQuiz,
  pickZone,
  proceedToFulfillmentOrPlace,
  proceedToLanguageOrPlace,
  saveOrderEmail,
  startCheckout,
  startQuiz,
} from "./checkout.server";
import { receiveProof, showOrders, showPoints } from "./receipt.server";

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

/** Код входа на витрину (В5): метку и код сверяет core/storefront/code-login. */
async function handleLoginCode(s: Shop, nonce: string): Promise<ShopOutcome> {
  const { env } = await import("@/config/env");
  const { codeLoginOpen } = await import("@/core/storefront/code-login-gate");
  if (!(await codeLoginOpen(s.ctx))) {
    await reply(s, plain(s.m.loginCodeBad), { force: true });
    return "handled";
  }
  const { issueLoginCode } = await import("@/core/storefront/code-login");
  const r = await issueLoginCode(s.ctx, env().SESSION_SECRET, s.customer, nonce);
  // Дальше диалог пишет состояние целиком (remember): берём свежее, иначе запись входа затрётся.
  if (r.ok) s.customer = r.customer;
  const text = r.ok
    ? s.m.loginCodeMsg(r.code, r.ttlMin)
    : r.reason === "wait"
      ? s.m.loginCodeWait
      : s.m.loginCodeBad;
  await reply(s, plain(text), { force: true });
  return "handled";
}

async function route(s: Shop, msg: ParsedZernioMessage): Promise<ShopOutcome> {
  const text = msg.text;
  let mode = s.customer.state.mode;
  s.why = explainIncoming({
    mode,
    text,
    postback: msg.postbackPayload,
    trigger: Boolean(text) && isTriggerWord(text, s.bot.triggers),
    attachments: msg.attachments.length,
  });

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

  // «вход <метка>» с сайта (В5): код для входа на витрину присылаем в этот же чат.
  const loginNonce = nonceFromMessage(text);
  if (loginNonce) return handleLoginCode(s, loginNonce);

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
    if (
      !["catalog", "cart", "orders", "points", "quiz", "reorder"].includes(command) &&
      !inDialog(s)
    )
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
      case "reorder":
        return reorderLast(s);
      case "country":
        await askCountry(s, false);
        return "handled";
    }
  }

  // Выбор языка не держит переписку: не язык в ответ — шаг снимается, реплика
  // разбирается как обычная (вопрос — продавцу). Повтор «Выберите язык» на
  // вопрос о работе встречал клиента в WhatsApp (скрин Якова, BOVI 29.09).
  if (mode === "awaiting_locale" && matchLocalePick(text) === null) {
    await setMode(s, { mode: "idle", locale_misses: undefined });
    mode = "idle";
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
      // Не язык сюда не доходит: шаг снят выше.
      const picked = matchLocalePick(text)!;
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
    case "product_tag": {
      if (!s.bot.features.search) return "question";
      return (await pickByTag(s, kind.tag)) ? "handled" : "question";
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
    const { serviceNoticeEnabled } = await import("@/core/notify/service-notices");
    if (await serviceNoticeEnabled(s.ctx, "photoNotReceipt"))
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

/** «Как в прошлый раз»: последний оплаченный заказ в корзину по текущим ценам и остаткам (Б11). */
async function reorderLast(s: Shop): Promise<ShopOutcome> {
  const order = await lastPaidOrder(s.ctx, s.customer);
  if (!order) {
    // Слово «повторить» в переписке с продавцом, где бот не говорил, — не наше.
    if (!inDialog(s)) return "question";
    await reply(s, s.m.reorderNoPaid, { force: true, buttons: [BTN.catalog(s.m)] });
    return "handled";
  }
  await reorderFrom(s, order);
  return "handled";
}

async function reorderFrom(s: Shop, order: OrderWithItems) {
  const report = await reorderReport(s.ctx, s.customer, order);
  const missing = report.short.length ? plain(s.m.reorderShort(shortLabels(report.short))) : "";
  if (!report.added) {
    await reply(s, [plain(s.m.reorderNothing), missing].filter(Boolean).join("\n"), {
      force: true,
      buttons: [BTN.catalog(s.m)],
    });
    return;
  }
  await showCart(
    s,
    true,
    [plain(s.m.reorderDone(report.added)), missing].filter(Boolean).join("\n"),
  );
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
    case "reorder":
    case "REORDER":
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
export async function askCountryFirst(s: Shop, then: string): Promise<boolean> {
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
      // Без номера — последний оплаченный заказ («повторить» кнопкой); с номером — свой заказ из «Моих заказов».
      if (!a) return reorderLast(s);
      const order = await getOrder(s.ctx, Number(a));
      if (!order || order.telegram_id !== s.customer.telegramId) return "handled";
      await reorderFrom(s, order);
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
      await choosePayment(s, a === "rk" || a === "pdm" ? a : "manual");
      return "handled";
    default:
      // Чужой postback (например, из comment-автоматизации Zernio) — не наш.
      return "question";
  }
}
