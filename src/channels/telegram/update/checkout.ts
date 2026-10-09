// Оформление заказа: страна, дата, зона, комментарий, создание заказа и реквизиты.
import { imageUrl } from "@/core/catalog/catalog";
import { isDeliveryLangChoice } from "@/core/catalog/materials";
import { sendPhotoOrText } from "../api";
import { orderThanksHtml } from "../screens";
import { escapeHtml, manualPayBtn, minOrderText, prodamusCopy } from "../copy";
import { localeFlags, localeNames } from "@/core/i18n/locale";
import { storefrontBase } from "@/core/tenant/custom-domain";
import { formatMoney } from "@/core/money/money";
import { setState } from "@/core/customers/customers";
import { cartCount, listCart } from "@/core/cart/cart";
import { freeDeliveryView } from "@/core/fulfillment/free-delivery-cart";
import {
  deliverOrder,
  displayNo,
  getOrder,
  listActivePaymentMethods,
  placeOrder,
} from "@/core/orders/orders";
import { notifyAdminNewOrder } from "../admin-notify";
import { notifyAdminsHtml, notifyDeliveryFailure } from "../notify";
import { telegramLanguageAsker, telegramMaterialSender } from "../deliver";
import { robokassaFor } from "@/core/payments/payment";
import {
  activeDeliveryZones,
  earliestFulfillmentDate,
  fulfillmentSettings,
  zoneFee,
} from "@/core/fulfillment/fulfillment";
import { closedRules, describeClosed, hasClosedDays } from "@/core/fulfillment/closed-days";
import { freeSlotsOnDate } from "@/core/fulfillment/capacity";
import { isoToDisplay } from "@/core/fulfillment/pure";
import { type Bot, mainMenu, send } from "./bot";
import { notifyReferral } from "./orders";

/**
 * Страна оплаты одна — спрашивать нечего: записываем её молча. Вопрос с
 * единственной кнопкой «Казахстан» покупатель из России читал как «вам сюда
 * нельзя» (Копилка Русоведа, 09.10), хотя карта РФ / СБП в заказе есть.
 */
export async function soleCountry(b: Bot): Promise<string | null> {
  const methods = await listActivePaymentMethods(b.ctx);
  const only = methods.length === 1 ? methods[0]! : null;
  if (!only) return null;
  b.customer = await setState(b.ctx, b.customer, {
    ...b.customer.state,
    country_code: only.country_code,
    country_name: only.country_name,
  });
  return only.country_code;
}

export async function askCountry(b: Bot, forCheckout: boolean): Promise<void> {
  const methods = await listActivePaymentMethods(b.ctx);
  if (methods.length === 1 && forCheckout && !b.customer.state.country_code) {
    const code = await soleCountry(b);
    if (code) return finishCheckout(b, code);
  }
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

export async function startCheckout(b: Bot) {
  if ((await cartCount(b.ctx, b.customer)) === 0) {
    await send(b, b.m.cartEmpty);
    return;
  }
  return continueCheckout(b);
}

export async function continueCheckout(b: Bot) {
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

export async function askFulfillmentDate(b: Bot) {
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
export async function answerApproval(
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

export async function afterDate(b: Bot) {
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

export async function askZoneOrAddress(b: Bot) {
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

export async function pickZone(b: Bot, zoneId: string) {
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

export async function askNote(b: Bot) {
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

export async function finishAfterNote(b: Bot, note: string | null) {
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

export async function finishCheckout(b: Bot, countryCode: string) {
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
  const { prodamusFor } = await import("@/core/payments/payment");
  const prodamus = await prodamusFor(b.ctx, order.currency);
  if (rk.ready || stars || crypto.ready || stripe.ready || prodamus.ready) {
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
            ...(prodamus.ready
              ? [
                  [
                    {
                      text: prodamusCopy(b.m, prodamus.currency).btn,
                      callback_data: `pay:pdm:${order.id}`,
                    },
                  ],
                ]
              : []),
            [
              {
                text: manualPayBtn(b.m, method.instructions),
                callback_data: `pay:manual:${order.id}`,
              },
            ],
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

export async function sendManualInstructions(
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
    // Обрыв или 5xx: подпись могла дойти вместе с фото — текст и QR вторым экземпляром не шлём.
    await sendPhotoOrText(
      b.api,
      { chat_id: b.chatId, photo: imageUrl(b.ctx, p.qr), caption: text, parse_mode: "HTML" },
      async () => {
        await send(b, text);
        await b.api.call("sendPhoto", { chat_id: b.chatId, photo: imageUrl(b.ctx, p.qr!) });
      },
    );
    return;
  }
  await send(b, text);
  if (p.qr) await b.api.call("sendPhoto", { chat_id: b.chatId, photo: imageUrl(b.ctx, p.qr) });
}
