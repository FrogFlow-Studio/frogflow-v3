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

const PRICE_UNSURE: Record<Locale, string> = {
  ru: "Точную стоимость уточню у менеджера — он напишет вам в ближайшее время.",
  kk: "Нақты бағасын менеджерден нақтылаймын — ол жақын арада сізге жазады.",
  en: "I'll check the exact price with a manager — they'll write to you soon.",
  uz: "Aniq narxni menejerdan so‘rayman — u tez orada sizga yozadi.",
};

const LEAD_DONE: Record<Locale, string> = {
  ru: "Спасибо, всё записал и передал менеджеру — он свяжется с вами для подтверждения.",
  kk: "Рахмет, бәрін жазып алдым да менеджерге бердім — ол растау үшін сізбен байланысады.",
  en: "Thank you, I've noted everything and passed it to a manager — they'll contact you to confirm.",
  uz: "Rahmat, hammasini yozib oldim va menejerga uzatdim — u tasdiqlash uchun siz bilan bog‘lanadi.",
};

const DIALOG_HANDOFF: Record<Locale, string> = {
  ru: "Передаю диалог менеджеру — он ответит в ближайшее время.",
  kk: "Диалогты менеджерге беремін — ол жақын арада жауап береді.",
  en: "I'm handing this conversation to a manager — they'll reply soon.",
  uz: "Suhbatni menejerga uzataman — u tez orada javob beradi.",
};

const CLARIFY: Record<Locale, string> = {
  ru: "Уточните, пожалуйста, что именно вас интересует — подскажу.",
  kk: "Нақты не қызықтыратынын айтыңызшы — көмектесемін.",
  en: "Could you tell me what exactly you're interested in? I'll help.",
  uz: "Iltimos, aynan nima qiziqtirayotganini ayting — yordam beraman.",
};

/** Цена не из каталога: ответ заменён, вопрос ушёл менеджеру. */
export const priceUnsureReply = (locale: Locale): string => PRICE_UNSURE[locale];
/** Заявка записана и передана менеджеру. */
export const leadDoneReply = (locale: Locale): string => LEAD_DONE[locale];
/** Модель передала диалог, не написав текста. */
export const dialogHandoffReply = (locale: Locale): string => DIALOG_HANDOFF[locale];
/** Модель ничего не ответила: просим уточнить. */
export const clarifyReply = (locale: Locale): string => CLARIFY[locale];
