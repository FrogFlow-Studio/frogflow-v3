import type { TenantContext } from "@/core/tenant/resolve.server";
import { setState, type Customer, type DialogState } from "@/core/customers/customers";
import type { Json } from "@/core/db-types";
import { isLocale, type Locale } from "@/core/i18n/locale";
import { listActivePaymentMethods } from "@/core/orders/orders";
import { activeDeliveryZones } from "@/core/fulfillment/fulfillment";
import { parseDateInput } from "@/core/fulfillment/pure";
import { loadQuiz } from "@/core/quiz/quiz";
import { cartLanguageChoices } from "@/core/cart/languages";
import { normalizePhone, type Msg } from "@/channels/telegram/copy";
import { type DmButton, type ZernioTransport } from "../api.server";
import { classifyZernioFailure, isAttachmentRejected } from "../errors";
import { type ZernioPlatform } from "../platform";
import {
  extractEmail,
  matchCountry,
  matchDeliveryLangChoice,
  matchLoyaltyPointsChoice,
  matchLocalePick,
  matchOrdinal,
  matchZone,
  plain,
} from "../shop-flow";
import { matchFulfillmentType } from "@/core/fulfillment/pure";
import { type DirectBotSettings } from "@/core/instagram/direct-bot-settings";

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

export type Shop = {
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
  /** Почему бот ответил (channels/zernio/reason): уходит в журнал диалога вместе с ответом. */
  why?: string | null;
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
export const SELLER_ACTIVE_MS = 30 * 60_000;

const HINT_WINDOW_MS = 10 * 60_000;

export function strict(s: Shop): boolean {
  return s.bot.scope === "purchases";
}

function sinceBotReply(s: Shop): number {
  const at = Date.parse(memory(s.customer).last_reply_at ?? "");
  return Number.isFinite(at) ? Date.now() - at : Infinity;
}

/** Бот в разговоре: в строгом режиме — только пока ответ бота свежий. */
export function inDialog(s: Shop): boolean {
  return !strict(s) || sinceBotReply(s) < ACTIVE_DIALOG_MS;
}

/** Подсказка на нераспознанный ответ: одна и только сразу после вопроса бота. */
export function mayHint(s: Shop): boolean {
  if (!strict(s)) return true;
  return !memory(s.customer).hinted && sinceBotReply(s) < HINT_WINDOW_MS;
}

/** Похож ли текст на ответ текущего шага. Свободный ввод (адрес, заметка) — всегда. */
export async function stepAnswerFits(s: Shop, mode: string, text: string): Promise<boolean> {
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
export async function photoFor(
  s: Shop,
  paths: ReadonlyArray<string | null | undefined>,
): Promise<string | undefined> {
  // Без проверки фото (транспорт в тестах) — без фото: непроверенное Meta может отклонить.
  if (!s.transport.imageInfo) return undefined;
  const { zernioImageUrl } = await import("../media.server");
  return (await zernioImageUrl(s.ctx, s.platform, paths, s.transport.imageInfo)) ?? undefined;
}

export const LIST_TTL_MS = 30 * 60 * 1000;

const REPEAT_WINDOW_MS = 90 * 1000;

export const PAGE = 10;

export function memory(c: Customer): DirectMemory {
  const d = c.state.direct;
  return d && typeof d === "object" && !Array.isArray(d) ? (d as DirectMemory) : {};
}

export async function remember(
  s: Shop,
  patch: Partial<DirectMemory>,
  state?: Partial<DialogState>,
) {
  const next = { ...memory(s.customer), ...patch };
  s.customer = await setState(s.ctx, s.customer, {
    ...s.customer.state,
    ...(state ?? {}),
    direct: next as Record<string, Json | undefined>,
  });
}

export async function setMode(s: Shop, state: Partial<DialogState>) {
  s.customer = await setState(s.ctx, s.customer, { ...s.customer.state, ...state });
}

export function localeOf(ctx: TenantContext, customer: Customer): Locale {
  const fromState = customer.state.locale;
  if (isLocale(fromState)) return fromState;
  return ctx.tenant.settings.default_locale ?? "ru";
}

export function fingerprint(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 200);
}

/**
 * Все ответы — через эту точку: повтор одного текста подряд подавляется
 * (доставка вебхука at-least-once, «Корзина пуста» дважды — из живой
 * переписки v1), неотправленный ответ последним не считается. `force` —
 * покупатель сам повторно вызвал то же меню.
 */
export async function reply(
  s: Shop,
  html: string,
  opts: {
    buttons?: DmButton[];
    attachmentUrl?: string;
    force?: boolean;
    interactive?: Json;
    /** Кнопки отклонены (отказ, не обрыв) — этот текст без кнопок. */
    textWithoutButtons?: string;
  } = {},
): Promise<boolean> {
  let text = plain(html).slice(0, 2000);
  const mem = memory(s.customer);
  const mark = fingerprint(text);
  const fresh =
    Boolean(mem.last_reply_at) && Date.now() - Date.parse(mem.last_reply_at!) < REPEAT_WINDOW_MS;
  if (!opts.force && mem.last_reply === mark && fresh) return false;
  const send = (attachmentUrl?: string, buttons = opts.buttons) =>
    s.transport.send(s.conversationId, s.accountId, text, {
      platform: s.platform,
      buttons,
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
  // Кнопки не приняли (отказ, а не обрыв: дошедшее не дублируем) — ссылка текстом.
  if (!r.ok && opts.textWithoutButtons && classifyZernioFailure(r.failure) === "permanent") {
    console.warn(`[zernio-shop] кнопки не приняты для ${s.customer.userKey}: ${r.error}`);
    text = plain(opts.textWithoutButtons).slice(0, 2000);
    r = await send(undefined, []);
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
      reason: s.why,
    });
  }
  return true;
}

export const BTN = {
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

export function hint(s: Shop): string {
  return s.locale === "ru"
    ? "Напишите номер товара или «каталог»; «корзина» — что уже выбрано."
    : `${plain(s.m.catalog)} · ${plain(s.m.cart)} · ${plain(s.m.myOrders)}`;
}
