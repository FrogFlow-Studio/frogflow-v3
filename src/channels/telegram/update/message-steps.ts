// Ответы текстом на шагах: оформление (способ, дата, слот, зона, адрес, комментарий),
// обращение в поддержку, промокод, подарок, сертификат, день рождения.
import { escapeHtml } from "../copy";
import { setState } from "@/core/customers/customers";
import { notifyAdminsHtml } from "../notify";
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
import { type Bot, send } from "./bot";
import { showCart } from "./cart";
import {
  afterDate,
  askFulfillmentDate,
  askNote,
  askZoneOrAddress,
  finishAfterNote,
  pickZone,
} from "./checkout";
import type { Customer } from "@/core/customers/customers";

/** Режимы оформления, где следующий текст покупателя — ответ на шаг. */
export const CHECKOUT_TEXT_MODES: ReadonlySet<unknown> = new Set([
  "awaiting_fulfillment_type",
  "awaiting_fulfillment_date",
  "awaiting_fulfillment_slot",
  "awaiting_delivery_zone",
  "awaiting_address",
  "awaiting_fulfillment_note",
]);

/** Режимы, где следующий текст — промокод, подарок, сертификат или день рождения. */
export const TYPED_INPUT_MODES: ReadonlySet<unknown> = new Set([
  "awaiting_birthday",
  "awaiting_promo_code",
  "awaiting_gift_recipient",
  "awaiting_gift_message",
  "awaiting_gift_certificate_code",
]);

/** Текст на шаге оформления (режим из CHECKOUT_TEXT_MODES). */
export async function checkoutTextStep(b: Bot, customer: Customer, text: string): Promise<void> {
  const { ctx } = b;
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
    const { fulfillmentSlots, normalizeSlot, withSlot } = await import("@/core/fulfillment/slots");
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

/** Текст обращения в поддержку (модуль helpdesk). */
export async function ticketText(
  b: Bot,
  customer: Customer,
  text: string,
  fromId: number,
): Promise<void> {
  const { ctx } = b;
  b.customer = await setState(ctx, customer, { ...customer.state, mode: "idle" });
  const { createTicket } = await import("@/core/helpdesk/tickets");
  const who = customer.firstName || (customer.username ? `@${customer.username}` : null);
  const { ticket, created } = await createTicket(ctx, {
    telegramId: fromId,
    customerName: who,
    platform: "telegram",
    subject: text,
  });
  if (ctx.tenant.modules.manager_chat) {
    const { recordMessage } = await import("@/core/chat/chat");
    await recordMessage(ctx, { telegramId: fromId, direction: "in", sender: "customer", text });
  }
  const { noticeLocale, ticketNoticeText } = await import("@/core/helpdesk/seller-texts");
  await notifyAdminsHtml(
    ctx,
    ticketNoticeText(
      await noticeLocale(ctx),
      created,
      ticket.number,
      `👤 ${escapeHtml(who ?? String(fromId))}`,
      escapeHtml(text.slice(0, 1000)),
    ),
    { kind: "question" },
  ).catch(() => 0);
  await send(b, created ? b.m.ticketCreated(ticket.number) : b.m.ticketAppended(ticket.number));
}

/** Промокод, подарок, сертификат или день рождения текстом (режим из TYPED_INPUT_MODES). */
export async function typedInput(b: Bot, customer: Customer, text: string): Promise<void> {
  const { ctx } = b;
  if (customer.state.mode === "awaiting_birthday") {
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
  if (customer.state.mode === "awaiting_promo_code") {
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
  if (customer.state.mode === "awaiting_gift_recipient") {
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
  if (customer.state.mode === "awaiting_gift_message") {
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
  if (customer.state.mode === "awaiting_gift_certificate_code") {
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
}
