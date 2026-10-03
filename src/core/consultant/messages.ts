import { isLocale, type Locale } from "@/core/i18n/locale";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Customer } from "@/core/customers/customers";

/** Язык ответа покупателю: выбранный в диалоге, иначе язык магазина, иначе русский. */
export function buyerLocale(ctx: TenantContext, customer: Customer | null): Locale {
  const chosen = customer?.state.locale;
  if (isLocale(chosen)) return chosen;
  const fallback = ctx.tenant.settings.default_locale;
  return isLocale(fallback) ? fallback : "ru";
}

const HANDOFF: Record<Locale, string> = {
  ru: "Передам ваш вопрос менеджеру — он ответит в ближайшее время.",
  kk: "Сұрағыңызды менеджерге жіберемін — ол жақын арада жауап береді.",
  en: "I'll pass your question to a manager — they'll reply soon.",
  uz: "Savolingizni menejerga yuboraman — u tez orada javob beradi.",
};

const UNAVAILABLE: Record<Locale, string> = {
  ru: "Сейчас не могу ответить — передаю вопрос менеджеру, он напишет вам.",
  kk: "Қазір жауап бере алмаймын — сұрақты менеджерге жіберемін, ол сізге жазады.",
  en: "I can't answer right now — I'm passing your question to a manager, who will write to you.",
  uz: "Hozir javob bera olmayman — savolni menejerga yuboraman, u sizga yozadi.",
};

/** «Передам вопрос менеджеру» — предел, пауза, отказ модели. */
export const handoffReply = (locale: Locale): string => HANDOFF[locale];
/** «Сейчас не могу ответить» — сбой консультанта. */
export const unavailableReply = (locale: Locale): string => UNAVAILABLE[locale];
