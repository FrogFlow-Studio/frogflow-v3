import { SUPPORTED_LOCALES, type Locale } from "@/core/i18n/locale";
import type { Tenant } from "@/core/tenant/types";
import { isOffHours } from "@/core/consultant/pricelist/mode";

/**
 * Тексты бота, которые продавец меняет на одной странице. Telegram:
 * приветствие, ответ вне часов работы, «спасибо за заказ» и «не понял»
 * (стандартные тексты — здесь и в экранах бота). Instagram Direct: шаги
 * покупки — страна, язык материалов, «после оплаты пришлите чек», чек и
 * почта (стандартные — фразы общего словаря бота, MSG_PROPS). Свои — в
 * bots.settings.bot_texts. Чистая часть: без базы и без каналов.
 */
export const BOT_TEXT_KEYS = [
  "welcome",
  "off_hours",
  "order_thanks",
  "not_understood",
  "country_ask",
  "language_ask",
  "pay_after",
  "receipt_how_to",
  "receipt_received",
  "receipt_received_email",
  "receipt_need_email",
  "receipt_manual",
  "receipt_verified",
  "email_ask",
  "email_retry",
] as const;
export type BotTextKey = (typeof BOT_TEXT_KEYS)[number];

export const BOT_TEXT_CHANNELS = ["telegram", "instagram", "whatsapp"] as const;
export type BotTextChannel = (typeof BOT_TEXT_CHANNELS)[number];

/** Длина своего текста: сообщение Telegram — 4096, оставляем запас на подстановки. */
export const BOT_TEXT_MAX = 1000;

/** Шаги покупки в Direct: их стандартный текст — фраза общего словаря бота. */
export const DIRECT_KEYS = [
  "country_ask",
  "language_ask",
  "pay_after",
  "receipt_how_to",
  "receipt_received",
  "receipt_received_email",
  "receipt_need_email",
  "receipt_manual",
  "receipt_verified",
  "email_ask",
  "email_retry",
] as const satisfies readonly BotTextKey[];

/**
 * Где текст уже подключён к канальному коду: страница не даёт сохранить то,
 * что бот не отправит. Instagram — шаги покупки (channels/zernio/shop/copy);
 * WhatsApp пока говорит стандартными словами.
 */
export const WIRED: Record<BotTextChannel, readonly BotTextKey[]> = {
  telegram: ["welcome", "off_hours", "order_thanks", "not_understood"],
  instagram: DIRECT_KEYS,
  whatsapp: [],
};

/**
 * Фразы общего словаря бота (COPY в channels/telegram/copy), которые
 * заменяет свой текст ключа. Фраза-функция получает аргументы по порядку
 * подстановок ключа: proofReceivedEmail(no, email) ↔ {order}, {email}.
 */
export const MSG_PROPS: Partial<Record<BotTextKey, readonly string[]>> = {
  country_ask: ["choosePayCountry", "chooseCountry"],
  language_ask: ["chooseDeliveryLanguage"],
  pay_after: ["afterProofManual"],
  receipt_how_to: ["receiptHowTo"],
  receipt_received: ["proofReceived"],
  receipt_received_email: ["proofReceivedEmail"],
  receipt_need_email: ["proofReceivedNeedEmail"],
  receipt_manual: ["receiptManualReview"],
  receipt_verified: ["receiptVerified"],
  email_ask: ["emailAsk"],
  email_retry: ["emailHint"],
};

/** Тексты про заказ: у консультанта без продаж их не показываем. */
export const SALES_ONLY: readonly BotTextKey[] = ["order_thanks", ...DIRECT_KEYS];

/** Подстановки, которые понимает каждый текст. */
export const BOT_TEXT_VARS: Record<BotTextKey, readonly string[]> = {
  welcome: ["shop"],
  off_hours: ["from", "to"],
  order_thanks: ["order"],
  not_understood: [],
  country_ask: [],
  language_ask: [],
  pay_after: [],
  receipt_how_to: [],
  receipt_received: ["order"],
  receipt_received_email: ["order", "email"],
  receipt_need_email: ["order"],
  receipt_manual: ["order"],
  receipt_verified: ["order"],
  email_ask: [],
  email_retry: [],
};

/**
 * «Спасибо за заказ» — дополнительное сообщение: пока продавец не задал свой
 * текст, не отправляется (у покупателя и так приходит подтверждение заказа).
 */
export const OPT_IN: readonly BotTextKey[] = ["order_thanks"];

type Words = Record<Locale, string>;

const OFF_HOURS: Words = {
  ru: "Сейчас мы не на связи: работаем с {from} до {to}. Напишите, что нужно, и мы ответим, как только вернёмся.",
  kk: "Қазір байланыста емеспіз: {from} - {to} аралығында жұмыс істейміз. Не керегін жазыңыз, оралысымен жауап береміз.",
  en: "We are offline right now: we work from {from} to {to}. Tell us what you need and we will reply as soon as we are back.",
  uz: "Hozir aloqada emasmiz: {from} dan {to} gacha ishlaymiz. Nima kerakligini yozing, qaytishimiz bilan javob beramiz.",
};

const ORDER_THANKS: Words = {
  ru: "Спасибо за заказ №{order}! Мы уже взялись за него.",
  kk: "№{order} тапсырыс үшін рахмет! Біз оны қолға алдық.",
  en: "Thank you for order #{order}! We have already started on it.",
  uz: "№{order}-buyurtma uchun rahmat! Biz uni allaqachon boshladik.",
};

/** Стандартные тексты без привязки к магазину (приветствие и «не понял» берутся из экранов бота). */
export const STANDARD: Partial<Record<BotTextKey, Words>> = {
  off_hours: OFF_HOURS,
  order_thanks: ORDER_THANKS,
};

/** Своё значение из настроек или null (нет, пусто, не строка). */
export function customText(
  tenant: Pick<Tenant, "settings">,
  key: BotTextKey,
  channel: BotTextChannel,
  locale: Locale,
): string | null {
  const v = tenant.settings.bot_texts?.[key]?.[channel]?.[locale];
  return typeof v === "string" && v.trim() ? v : null;
}

/** Подставить {имя} из vars; незнакомые {…} остаются как есть. */
export function fillText(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? vars[name]! : m));
}

/** Текст из формы: без управляющих символов, обрезан по краям; пусто — null (сброс). */
export function cleanBotText(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = [...raw.replace(/\r\n?/g, "\n")]
    .filter((ch) => {
      const c = ch.charCodeAt(0);
      return c === 9 || c === 10 || c >= 32; // табуляция и перевод строки остаются
    })
    .join("")
    .trim();
  return t ? t.slice(0, BOT_TEXT_MAX) : null;
}

/** Подстановки, которых нет в списке текста (опечатка продавца вроде {shpo}). */
export function unknownVars(key: BotTextKey, text: string): string[] {
  const known = new Set(BOT_TEXT_VARS[key]);
  return [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).filter((n) => !known.has(n));
}

export type WorkHours = { open: number; close: number };

/** Часы из формы: целые 0–24, начало и конец разные; иначе null (часов нет). */
export function cleanWorkHours(raw: unknown): WorkHours | null {
  const h = raw as { open?: unknown; close?: unknown } | null | undefined;
  const ok = (n: unknown): n is number =>
    typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 24;
  return h && ok(h.open) && ok(h.close) && h.open !== h.close
    ? { open: h.open, close: h.close }
    : null;
}

export const hhmm = (n: number) => `${String(n % 24).padStart(2, "0")}:00`;

/** Сейчас вне рабочих часов магазина? Часов нет — никогда. */
export function outsideWorkHours(
  tenant: Pick<Tenant, "settings">,
  now: Date,
  timezone: string,
): boolean {
  const h = cleanWorkHours(tenant.settings.work_hours);
  return h ? isOffHours(now, h, timezone) : false;
}

/** Свой текст с подставленными {именами}; null — своего нет, значит работает стандартный. */
export function customFilled(
  tenant: Pick<Tenant, "settings">,
  key: BotTextKey,
  channel: BotTextChannel,
  locale: Locale,
  vars: Record<string, string> = {},
): string | null {
  const c = customText(tenant, key, channel, locale);
  return c === null ? null : fillText(c, vars);
}

/** Образцы значений для предпросмотра на странице продавца. */
export function sampleVars(shopName: string, hours: WorkHours | null): Record<string, string> {
  return {
    shop: shopName,
    order: "1234",
    email: "anna@mail.ru",
    from: hhmm(hours?.open ?? 10),
    to: hhmm(hours?.close ?? 21),
  };
}

/** Разбор bots.settings.bot_texts при чтении арендатора: только известные ключи, каналы и языки; пустое не храним. */
export function parseBotTexts(raw: unknown): Tenant["settings"]["bot_texts"] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const out: NonNullable<Tenant["settings"]["bot_texts"]> = {};
  for (const key of BOT_TEXT_KEYS) {
    const byChannel = (raw as Record<string, unknown>)[key];
    if (!byChannel || typeof byChannel !== "object" || Array.isArray(byChannel)) continue;
    const channels: NonNullable<NonNullable<Tenant["settings"]["bot_texts"]>[BotTextKey]> = {};
    for (const channel of BOT_TEXT_CHANNELS) {
      const byLocale = (byChannel as Record<string, unknown>)[channel];
      if (!byLocale || typeof byLocale !== "object" || Array.isArray(byLocale)) continue;
      const texts: Partial<Record<Locale, string>> = {};
      for (const l of SUPPORTED_LOCALES) {
        const v = cleanBotText((byLocale as Record<string, unknown>)[l]);
        if (v) texts[l] = v;
      }
      if (Object.keys(texts).length) channels[channel] = texts;
    }
    if (Object.keys(channels).length) out[key] = channels;
  }
  return Object.keys(out).length ? out : undefined;
}
