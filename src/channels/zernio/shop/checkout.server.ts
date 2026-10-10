import { getSetting } from "@/core/settings/settings";
import { recordEngage } from "@/core/automsg/engage";
import { setEmail, setState } from "@/core/customers/customers";
import { localeNames } from "@/core/i18n/locale";
import { getProduct, type Product } from "@/core/catalog/catalog";
import { cartCount, listCart, priceCart } from "@/core/cart/cart";
import { formatMoney } from "@/core/money/money";
import { rubEquivalent, withRub } from "@/core/payments/rub-equivalent";
import { allPriceCountries, payAtLastStep, payChoiceTotals } from "@/core/pricing/all-prices";
import { defaultCountryCode } from "@/core/pricing/pricing";
import {
  displayNo,
  getOrder,
  setOrderEmail,
  listActivePaymentMethods,
  placeOrder,
  type OrderWithItems,
} from "@/core/orders/orders";
import { giftWrapForCart } from "@/core/orders/gift-wrap";
import {
  activeDeliveryZones,
  amountDueNow,
  fulfillmentSettings,
  earliestFulfillmentDate,
  zoneFee,
} from "@/core/fulfillment/fulfillment";
import { closedRules, describeClosed, hasClosedDays } from "@/core/fulfillment/closed-days";
import { freeSlotsOnDate } from "@/core/fulfillment/capacity";
import { isoToDisplay } from "@/core/fulfillment/pure";
import {
  kaspiApipayFor,
  prodamusFor,
  prodamusOrderUrl,
  robokassaFor,
  robokassaReceipt,
} from "@/core/payments/payment";
import { buildPaymentUrl } from "@/core/payments/robokassa";
import { loadQuiz, quizResult, type Quiz } from "@/core/quiz/quiz";
import { isDeliveryLangChoice } from "@/core/catalog/materials";
import { askDeliveryLangBeforeOrder, cartLanguageChoices } from "@/core/cart/languages";
import { freeDeliveryView } from "@/core/fulfillment/free-delivery-cart";
import { localeFlags as flags, SUPPORTED_LOCALES } from "@/core/i18n/locale";
import {
  escapeHtml,
  manualPayBtn,
  minOrderText,
  prodamusCopy,
  prodamusAnyCardLine,
  prodamusSum,
} from "@/channels/telegram/copy";
import { adminTelegramApi } from "@/channels/telegram/notify";
import { isMailConfigured } from "@/core/mail/mail.server";
import { emailStep, languagePickerText, WA_LIST_MAX_ROWS, clipRowTitle, plain } from "../shop-flow";
import { BTN, type Shop, memory, photoFor, reply, setMode } from "./context.server";
import { showProductList, stepList } from "./catalog.server";
import { deliverHere } from "./receipt.server";

// ── оформление ────────────────────────────────────────────────────────

export async function askLocale(s: Shop) {
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

export async function askCountry(s: Shop, forCheckout: boolean) {
  const methods = await listActivePaymentMethods(s.ctx);
  if (methods.length === 0) {
    await reply(s, s.m.paymentNotConfigured);
    return;
  }
  // Одна страна оплаты — выбирать нечего: ставим молча и идём дальше. Вопрос
  // «1. Казахстан» гонял покупателей по кругу (Копилка русоведа 09.10).
  if (methods.length === 1) {
    const only = methods[0]!;
    await setMode(s, {
      mode: "idle",
      country_code: only.country_code,
      country_name: only.country_name,
      placing_order: undefined,
    });
    if (forCheckout) await proceedToFulfillmentOrPlace(s, only.country_code);
    else await reply(s, s.m.countrySaved(only.country_name), { force: true });
    return;
  }
  await setMode(s, { mode: "awaiting_country", placing_order: forCheckout ? true : undefined });
  // Цены во всех валютах: это шаг оплаты — у каждой страны сумма корзины.
  const totals = forCheckout ? await payChoiceTotals(s.ctx, s.customer) : null;
  const prompt = plain(totals ? s.m.choosePayCountry : s.m.chooseCountry);
  const titles = methods.map((m) => {
    const sum = totals?.get(m.country_code);
    return sum ? `${m.country_name} — ${formatMoney(sum.amount, sum.currency)}` : m.country_name;
  });
  const lines = titles.map((t, i) => `${i + 1}. ${t}`);
  if (s.platform === "whatsapp" && methods.length <= WA_LIST_MAX_ROWS) {
    await reply(s, prompt, {
      force: true,
      interactive: stepList(
        prompt,
        s.locale === "ru" ? "Выбрать страну" : plain(s.m.chooseCountry).slice(0, 20),
        prompt,
        titles,
      ),
    });
    return;
  }
  await reply(s, `${prompt}\n\n${lines.join("\n")}`, { force: true });
}

/**
 * Квиз-подбор (core/quiz): вопросы по одному, ответ — номер варианта (в WhatsApp
 * ещё строка списка). Подсчёт ответов и результат — в core/quiz, здесь только
 * показ: те же ответы дают тот же результат, что в Telegram и на сайте.
 */
export async function startQuiz(s: Shop): Promise<void> {
  const quiz = await loadQuiz(s.ctx);
  if (!s.ctx.tenant.modules.quiz || !quiz.questions.length) {
    await reply(s, plain(s.m.quizNotReady), { force: true, buttons: [BTN.catalog(s.m)] });
    return;
  }
  await setMode(s, { mode: "awaiting_quiz", quiz_tags: [], quiz_q: 0 });
  if (quiz.intro) await reply(s, escapeHtml(quiz.intro), { force: true });
  await askQuizQuestion(s, quiz, 0);
}

export async function askQuizQuestion(s: Shop, quiz: Quiz, q: number): Promise<void> {
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

export async function finishQuiz(s: Shop, tags: string[]): Promise<void> {
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

export async function startCheckout(s: Shop) {
  if ((await cartCount(s.ctx, s.customer)) === 0) {
    if (await resumePendingPayChoice(s)) return;
    await reply(s, s.m.cartEmpty, { force: true, buttons: [BTN.catalog(s.m)] });
    return;
  }
  await continueCheckout(s);
}

export async function continueCheckout(s: Shop) {
  const items = await listCart(s.ctx, s.customer);
  const physical = items.some((i) => i.products?.fulfillment_kind === "physical");
  // Телефон нужен только для физического заказа: цифровой выдаётся сюда же, в переписку.
  if (physical && !s.customer.contactPhone) {
    await setMode(s, { mode: "awaiting_contact" });
    await reply(s, s.m.phonePromptHtml, { force: true });
    return;
  }
  // Цены во всех валютах, корзина цифровая: страну (валюту) спросим на шаге
  // оплаты, с суммами; до него считаем по прежней или домашней стране.
  if (await payAtLastStep(s.ctx, s.customer)) {
    await setMode(s, { pay_choice_pending: true });
    const cc = s.customer.state.country_code ?? (await defaultCountryCode(s.ctx));
    if (cc) return proceedToFulfillmentOrPlace(s, cc);
  } else if (s.customer.state.pay_choice_pending) {
    // Отметка брошенного оформления не тянется в новое.
    await setMode(s, { pay_choice_pending: undefined });
  }
  if (!s.customer.state.country_code) return askCountry(s, true);
  return proceedToFulfillmentOrPlace(s, s.customer.state.country_code);
}

export async function proceedToFulfillmentOrPlace(s: Shop, countryCode: string) {
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

export async function askFulfillmentDate(s: Shop) {
  const rules = await closedRules(s.ctx);
  const minIso = await earliestFulfillmentDate(s.ctx, s.customer, rules);
  await setMode(s, { mode: "awaiting_fulfillment_date", checkout_min_fulfillment_date: minIso });
  const note = hasClosedDays(rules)
    ? `\n${s.m.fulfillmentClosedNote(describeClosed(rules, s.locale))}`
    : "";
  await reply(s, s.m.fulfillmentDatePrompt(isoToDisplay(minIso)) + note, { force: true });
}

export async function afterDate(s: Shop) {
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

export async function askZoneOrAddress(s: Shop) {
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

export async function pickZone(s: Shop, zoneId: string) {
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

export async function askNote(s: Shop) {
  await setMode(s, { mode: "awaiting_fulfillment_note" });
  await reply(s, s.m.fulfillmentNotePrompt, {
    force: true,
    buttons: [{ type: "postback", title: plain(s.m.fulfillmentNoteSkipBtn), payload: "NOTE:skip" }],
  });
}

export async function finishAfterNote(s: Shop, note: string | null) {
  await setMode(s, { checkout_fulfillment_note: note ?? undefined, mode: "idle" });
  const cc = s.customer.state.country_code;
  if (!cc) return askCountry(s, true);
  return finishCheckout(s, cc);
}

/** Язык материалов до оформления — списком: языки корзины, затем «все языки ×N». */
export async function proceedToLanguageOrPlace(s: Shop, countryCode: string) {
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
export async function saveOrderEmail(s: Shop, orderId: number, email: string) {
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
      const r = await emailOrderMaterials(s.ctx, fresh, s.transport.mailer).catch((e) => {
        console.warn(`[zernio] письмо по заказу #${orderId}: ${String(e)}`);
        return { sent: false };
      });
      // Заказ уже выдан и письмо ушло — не «придут после проверки оплаты» (заказ #82 Копилки, 10.10).
      if (r.sent) {
        const { emailSentNow } = await import("@/core/postpay/postpay");
        await reply(s, emailSentNow(s.locale, email), { force: true });
        return;
      }
    }
  }
  await reply(s, s.m.emailSaved(email), { force: true });
}

/** После чека: заказу из Instagram без почты — спросить её (заказ мог прийти из v1 или до шага). */
export async function askOrderEmailIfMissing(s: Shop, order: OrderWithItems): Promise<boolean> {
  if (
    s.platform !== "instagram" ||
    memory(s.customer).email_skipped === true ||
    order.fulfillment_kind === "physical" ||
    order.customer_email?.trim() ||
    !(s.transport.mailReady ?? isMailConfigured)()
  )
    return false;
  // Продавец выдаёт только в чат: почту не спрашиваем (core/orders/email-ask).
  const { CHAT_EMAIL_ASK_KEY, emailAskOn } = await import("@/core/orders/email-ask");
  if (!emailAskOn(await getSetting(s.ctx, CHAT_EMAIL_ASK_KEY), s.ctx.tenant.id)) return false;
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

export async function askPoints(s: Shop) {
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

export async function askGift(s: Shop) {
  await reply(s, plain(s.m.giftAsk), {
    force: true,
    buttons: [
      { type: "postback", title: plain(s.m.giftYesBtn), payload: "GIFT:yes" },
      { type: "postback", title: plain(s.m.giftNoBtn), payload: "GIFT:no" },
    ],
  });
}

export async function afterGiftChoice(s: Shop, countryCode: string, yes: boolean) {
  if (!yes) {
    await setMode(s, { mode: "idle", gift_reask: undefined });
    return finishCheckout(s, countryCode);
  }
  await setMode(s, { mode: "awaiting_gift_recipient", gift_on: true, gift_reask: undefined });
  await reply(s, plain(s.m.giftRecipientPrompt), { force: true });
}

export async function askGiftMessage(s: Shop) {
  await reply(s, plain(s.m.giftMessagePrompt), {
    force: true,
    buttons: [{ type: "postback", title: plain(s.m.giftSkipBtn), payload: "GIFT:skip" }],
  });
}

export async function finishAfterGift(s: Shop, message: string | null) {
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

export async function askGiftWrap(s: Shop) {
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

export async function finishCheckout(s: Shop, countryCode: string) {
  if (s.customer.state.pay_choice_pending && (await allPriceCountries(s.ctx)))
    return askCountry(s, true);
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
  const pdm = await prodamusFor(s.ctx, order.currency);
  const kaspi = await kaspiApipayFor(s.ctx, order.currency);
  if (rk.ready || pdm.ready || kaspi.ready) {
    s.customer = await setState(s.ctx, s.customer, {
      ...rest,
      mode: "choose_pay",
      pending_order_id: order.id,
      pending_display_no: no,
    });
    await sendPayChoice(s, {
      orderId: order.id,
      no,
      due,
      currency: order.currency,
      instructions: method.instructions,
      items: (order.order_items ?? []).map((i) => i.name_snapshot),
    });
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
    items: (order.order_items ?? []).map((i) => i.name_snapshot),
  });
}

/**
 * «Выберите способ оплаты» с кнопками. Способы названы и словами: кнопки
 * покупательница не заметила, дважды нажала «Оформить заказ» и ушла в
 * каталог (заказ #19 Копилки русоведа, 09.10).
 */
async function sendPayChoice(
  s: Shop,
  p: {
    orderId: number;
    no: number;
    due: number;
    currency: string;
    instructions: string | null;
    items?: string[];
  },
) {
  const rk = await robokassaFor(s.ctx, p.currency);
  const pdm = await prodamusFor(s.ctx, p.currency);
  const kaspi = await kaspiApipayFor(s.ctx, p.currency);
  const online = [
    ...(kaspi.ready
      ? [
          {
            type: "postback" as const,
            title: plain(s.m.payViaKaspiApipayBtn),
            payload: "PAY:kaspi",
          },
        ]
      : []),
    ...(rk.ready
      ? [{ type: "postback" as const, title: plain(s.m.payViaRobokassaBtn), payload: "PAY:rk" }]
      : []),
    ...(pdm.ready
      ? [
          {
            type: "postback" as const,
            title: plain(prodamusCopy(s.m, pdm.currency, p.currency).btn),
            payload: "PAY:pdm",
          },
        ]
      : []),
  ];
  // Instagram показывает не больше трёх кнопок: перевод по реквизитам остаётся всегда.
  const buttons = [
    ...online.slice(0, 2),
    {
      type: "postback" as const,
      title: plain(manualPayBtn(s.m, p.instructions)),
      payload: "PAY:manual",
    },
  ];
  // Форма Продамуса *.kz принимает только карты РФ (скрин формы Копилки, 10.10): говорим это прямо.
  const anyCard =
    pdm.ready && buttons.some((b) => b.payload === "PAY:pdm")
      ? `\n\n${plain(prodamusAnyCardLine(s.m, pdm.currency))}`.trimEnd()
      : "";
  // «1700 ₸ / 470 ₽»: покупатели из России принимали 1700 за рубли (Копилка, 10.10).
  const rub = anyCard
    ? await rubEquivalent(s.ctx, pdm, { id: p.orderId, due: p.due, currency: p.currency })
    : null;
  await reply(
    s,
    `${plain(s.m.manualTitleNew(p.no))}\n${itemsLine(p.items)}\n${plain(s.m.amountToPay(withRub(formatMoney(p.due, p.currency), rub)))}\n\n${plain(s.m.choosePayMethodNamed(buttons.map((b) => b.title)))}${anyCard}`,
    { force: true, buttons },
  );
}

/**
 * Что в заказе — строкой над суммой: в быстрой покупке это единственное
 * сообщение, и покупатель должен видеть, за что платит. Короткая: с кнопками
 * Instagram берёт не больше 640 знаков текста.
 */
function itemsLine(items: string[] | undefined): string {
  const names = (items ?? []).map((n) => n.trim()).filter(Boolean);
  if (!names.length) return "";
  const line = names.join(", ");
  return `${line.length > 120 ? `${line.slice(0, 119)}…` : line}\n`;
}

/**
 * Повторное «Оформить заказ», когда корзина уже стала заказом и он ждёт
 * выбора оплаты: показываем этот заказ с кнопками оплаты, а не «Корзина
 * пуста» (заказ #19 Копилки русоведа, 09.10). true — показали.
 */
async function resumePendingPayChoice(s: Shop): Promise<boolean> {
  if (s.customer.state.mode !== "choose_pay") return false;
  const orderId = Number(s.customer.state.pending_order_id);
  const order = orderId ? await getOrder(s.ctx, orderId) : null;
  if (!order || order.telegram_id !== s.customer.telegramId || order.status !== "awaiting_payment")
    return false;
  const method = (await listActivePaymentMethods(s.ctx)).find(
    (x) => x.country_code === order.country_code,
  );
  const due = await amountDueNow(s.ctx, {
    total: Number(order.total),
    fulfillment_kind: order.fulfillment_kind,
  });
  await sendPayChoice(s, {
    orderId: order.id,
    no: displayNo(order),
    due,
    currency: order.currency,
    instructions: method?.instructions ?? null,
    items: (order.order_items ?? []).map((i) => i.name_snapshot),
  });
  return true;
}

/**
 * Быстрая покупка того же товара, когда его заказ уже ждёт оплаты (двойное
 * нажатие «Купить», повторный «+»): тот же заказ с оплатой, а не второй
 * заказ. true — показали.
 */
export async function resumeExpressOrder(s: Shop, productId: string): Promise<boolean> {
  const mode = s.customer.state.mode;
  if (mode !== "choose_pay" && mode !== "awaiting_proof") return false;
  const orderId = Number(s.customer.state.pending_order_id);
  const order = orderId ? await getOrder(s.ctx, orderId) : null;
  if (!order || order.telegram_id !== s.customer.telegramId || order.status !== "awaiting_payment")
    return false;
  const items = order.order_items ?? [];
  if (items.length !== 1 || items[0]!.product_id !== productId) return false;
  if (mode === "choose_pay") return resumePendingPayChoice(s);
  const method = (await listActivePaymentMethods(s.ctx)).find(
    (x) => x.country_code === order.country_code,
  );
  const physical = order.fulfillment_kind === "physical";
  const due = await amountDueNow(s.ctx, {
    total: Number(order.total),
    fulfillment_kind: order.fulfillment_kind,
  });
  await sendManualInstructions(s, {
    no: displayNo(order),
    due,
    currency: order.currency,
    instructions: method?.instructions ?? null,
    qr: method?.qr_code_path ?? null,
    physical,
    depositLine: "",
    items: items.map((i) => i.name_snapshot),
  });
  return true;
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
    items?: string[];
  },
) {
  // Реквизиты — ссылка (pay.kaspi.kz): в Instagram ссылка в тексте у части
  // покупателей не нажимается, жали «Перевод Kaspi» по три раза и писали «Не
  // нажимается» (Копилка русоведа, 09.10). Ссылка — ещё и кнопкой, в тексте
  // остаётся, чтобы её можно было скопировать.
  const link = s.platform === "instagram" ? payLinkOf(p.instructions) : null;
  const text =
    `${plain(s.m.manualTitleNew(p.no))}\n${itemsLine(p.items)}\n${plain(s.m.amountToPay(formatMoney(p.due, p.currency)))}\n${p.depositLine}\n` +
    `${p.instructions || plain(s.m.defaultInstructions)}\n\n` +
    (link ? `${plain(s.m.payLinkHint)}\n\n` : "") +
    plain(p.physical ? s.m.afterProofPhysical : s.m.afterProofManual);
  await reply(s, text, {
    force: true,
    attachmentUrl: await photoFor(s, [p.qr]),
    ...(link
      ? {
          buttons: [
            { type: "url" as const, title: plain(s.m.payLinkBtn(/kaspi/i.test(link))), url: link },
          ],
          textWithoutButtons: text,
        }
      : {}),
  });
}

/** Первая ссылка https из реквизитов продавца — для кнопки оплаты. */
export function payLinkOf(instructions: string | null): string | null {
  const m = /https:\/\/[^\s<>"'«»]+/i.exec(instructions ?? "");
  return m ? m[0].replace(/[.,;:!?)\]]+$/, "") : null;
}

/**
 * Ссылка на оплату — только в кнопке: с кнопками Instagram берёт не больше 640
 * знаков текста, а подписанная ссылка Продамуса длиннее (~700). Текст со
 * ссылкой и кнопкой не уходил вовсе: заказ #15 Копилки Русоведа, 09.10.
 */
async function sendPayLink(s: Shop, text: string, title: string, url: string, asText = false) {
  // «А ссылка где?»: та же ссылка текстом, без кнопки (заказ #98 Копилки, 10.10).
  if (asText) {
    await reply(s, plain(s.m.payLinkAsText(url)), { force: true });
    return;
  }
  await reply(s, text, {
    force: true,
    buttons: [{ type: "url", title, url }],
    textWithoutButtons: `${text}\n\n${url}`,
  });
}

/**
 * `ruCard` — покупатель написал «из России», «рублями» на шаге оплаты: та же
 * ссылка Продамуса с пояснением, что карта РФ подходит (Копилка, #73, 10.10).
 * Возвращает true, когда ссылку Продамуса отправили.
 */
export async function choosePayment(
  s: Shop,
  kind: "kaspi" | "rk" | "pdm" | "manual",
  opts: { ruCard?: boolean; asText?: boolean } = {},
): Promise<boolean | undefined> {
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
      pay_link: "rk",
    });
    await sendPayLink(
      s,
      `${plain(s.m.manualTitleNew(no))}\n\n${plain(s.m.amountToPay(formatMoney(due, order.currency)))}\n\n${plain(s.m.robokassaHint)}`,
      plain(s.m.payViaRobokassaBtn),
      url,
      opts.asText,
    );
    return true;
  }
  if (kind === "kaspi") {
    const cfg = await kaspiApipayFor(s.ctx, order.currency);
    if (!cfg.ready) return;
    const { createKaspiLink } = await import("@/core/payments/kaspi-apipay");
    const link = await createKaspiLink(cfg, {
      orderId: order.id,
      amount: due,
      description: `Заказ #${no}`,
    });
    if (!link.ok) {
      console.error(`[kaspi:${s.ctx.tenant.id}] ссылка по заказу ${order.id}: ${link.error}`);
      await reply(s, plain(s.m.kaspiApipayUnavailable), { force: true });
      return;
    }
    await setMode(s, {
      mode: "awaiting_payment",
      pending_order_id: order.id,
      pending_display_no: no,
      // Ссылку Kaspi текстом не повторяем: новая ссылка — новый счёт.
      pay_link: undefined,
    });
    await sendPayLink(
      s,
      `${plain(s.m.manualTitleNew(no))}\n\n${plain(s.m.amountToPay(formatMoney(due, order.currency)))}\n\n${plain(s.m.kaspiApipayHint)}`,
      plain(s.m.payViaKaspiApipayBtn),
      link.url,
    );
    return;
  }
  if (kind === "pdm") {
    const cfg = await prodamusFor(s.ctx, order.currency);
    if (!cfg.ready) return;
    const { orderPageUrl } = await import("@/core/storefront/web-order");
    const link = await prodamusOrderUrl(s.ctx, cfg, {
      orderId: order.id,
      no,
      due,
      currency: order.currency,
      back: (await orderPageUrl(s.ctx, order.id)) ?? s.ctx.appUrl,
      email: order.customer_email,
    });
    if (!link) return;
    // Форма в тенге: рядом рубли, иначе 1700 принимают за рубли (Копилка, 10.10).
    const sum = withRub(
      prodamusSum(s.m, link, due, order.currency),
      link.currency.toUpperCase() === "KZT"
        ? await rubEquivalent(s.ctx, cfg, { id: order.id, due, currency: order.currency })
        : null,
    );
    const url = link.url;
    const copy = prodamusCopy(s.m, link.currency, order.currency);
    // Форма в тенге, покупатель из России: карта РФ подходит, банк спишет рубли.
    const hint =
      opts.ruCard && link.currency.toUpperCase() !== "RUB" ? s.m.prodamusRubViaKztHint : copy.hint;
    await setMode(s, {
      mode: "awaiting_payment",
      pending_order_id: order.id,
      pending_display_no: no,
      pay_link: "pdm",
    });
    // Кнопка ссылки — не тем же словом, что способ оплаты: «💳 Картой РФ» дважды
    // приняли за ту же кнопку и спросили «А ссылка где?» (заказ #98 Копилки, 10.10).
    await sendPayLink(
      s,
      `${plain(s.m.manualTitleNew(no))}\n\n${plain(s.m.amountToPay(sum))}\n\n${plain(hint)}`,
      plain(s.m.payLinkBtn(false)),
      url,
      opts.asText,
    );
    return true;
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
