import { isLocale, type Locale } from "@/core/i18n/locale";
import { getSettings } from "@/core/settings/settings";
import type { TenantContext } from "@/core/tenant/resolve.server";

/** Язык сообщений продавцу: язык админки, иначе язык магазина, иначе русский. Сбой чтения — не повод молчать. */
export async function sellerLocaleSafe(ctx: TenantContext): Promise<Locale> {
  try {
    const st = await getSettings(ctx, ["admin_locale"]);
    if (isLocale(st.admin_locale)) return st.admin_locale;
  } catch {
    /* возьмём язык магазина */
  }
  const d = ctx.tenant.settings.default_locale;
  return isLocale(d) ? d : "ru";
}

const EMPTY: Record<Locale, string> = {
  ru: "🔴 <b>ИИ-баланс закончился.</b>\n\nИИ-консультант передаёт диалоги менеджеру, чеки проверяете вы. Пополните баланс в админке: «ИИ-баланс».",
  kk: "🔴 <b>ЖИ-баланс таусылды.</b>\n\nЖИ-кеңесші диалогтарды менеджерге береді, түбіртектерді өзіңіз тексересіз. Балансты әкімші панелінде толықтырыңыз: «ЖИ-баланс».",
  en: "🔴 <b>The AI balance has run out.</b>\n\nThe AI consultant hands dialogs over to the manager and you check receipts yourself. Top up the balance in the admin panel: “AI balance”.",
  uz: "🔴 <b>SI balansi tugadi.</b>\n\nSI maslahatchi suhbatlarni menejerga topshiradi, cheklarni o‘zingiz tekshirasiz. Balansni admin panelida to‘ldiring: «SI balansi».",
};

const LOW: Record<Locale, (usd: string) => string> = {
  ru: (u) =>
    `🟡 <b>ИИ-баланс почти закончился:</b> осталось $${u}.\n\nПополните баланс в админке: «ИИ-баланс», чтобы ИИ не остановился.`,
  kk: (u) =>
    `🟡 <b>ЖИ-баланс таусылуға жақын:</b> $${u} қалды.\n\nЖИ тоқтамауы үшін балансты әкімші панелінде толықтырыңыз: «ЖИ-баланс».`,
  en: (u) =>
    `🟡 <b>The AI balance is almost out:</b> $${u} left.\n\nTop up the balance in the admin panel: “AI balance”, so the AI doesn't stop.`,
  uz: (u) =>
    `🟡 <b>SI balansi tugab qoldi:</b> $${u} qoldi.\n\nSI to‘xtab qolmasligi uchun balansni admin panelida to‘ldiring: «SI balansi».`,
};

/** Предупреждение продавцу о балансе ИИ (HTML Telegram). */
export function balanceWarning(locale: Locale, kind: "low" | "empty", usd: number): string {
  return kind === "empty" ? EMPTY[locale] : LOW[locale](Math.max(0, usd).toFixed(2));
}

export type Note =
  | "accounting"
  | "balance"
  | "limit"
  | "catalog"
  | "failure"
  | "budget"
  | "empty"
  | "slow"
  | "price"
  | "injection"
  | "wholesale";
const NOTES: Record<Note, Record<Locale, string>> = {
  accounting: {
    ru: "Сбой учёта расхода консультанта.",
    kk: "Консультант шығынын есепке алу сәтсіз болды.",
    en: "The consultant's cost accounting failed.",
    uz: "Maslahatchi xarajatini hisobga olishda nosozlik.",
  },
  balance: {
    ru: "Сбой учёта ИИ-баланса.",
    kk: "ЖИ-балансты есепке алу сәтсіз болды.",
    en: "AI balance accounting failed.",
    uz: "SI balansini hisobga olishda nosozlik.",
  },
  limit: {
    ru: "ИИ-консультант: исчерпан лимит диалогов плана.",
    kk: "ЖИ-кеңесші: тариф диалог лимиті таусылды.",
    en: "AI consultant: the plan's dialog limit is used up.",
    uz: "SI maslahatchi: tarif suhbat limiti tugadi.",
  },
  catalog: {
    ru: "Сбой чтения каталога.",
    kk: "Каталогты оқу сәтсіз болды.",
    en: "Failed to read the catalog.",
    uz: "Katalogni o‘qishda nosozlik.",
  },
  budget: {
    ru: "ИИ-консультант: дневной предел расходов или ответов исчерпан, до полуночи UTC вопросы уходят менеджеру.",
    kk: "ЖИ-кеңесші: шығын немесе жауаптың күндік шегі таусылды, UTC түн ортасына дейін сұрақтар менеджерге барады.",
    en: "AI consultant: the daily spend or reply limit is used up; until midnight UTC questions go to the manager.",
    uz: "SI maslahatchi: xarajat yoki javoblarning kunlik chegarasi tugadi, UTC yarim tungacha savollar menejerga boradi.",
  },
  empty: {
    ru: "ИИ-консультант: ИИ-баланс закончился, вопросы уходят менеджеру, пока баланс не пополнят.",
    kk: "ЖИ-кеңесші: ЖИ-баланс таусылды, баланс толықтырылғанша сұрақтар менеджерге барады.",
    en: "AI consultant: the AI balance has run out; questions go to the manager until it is topped up.",
    uz: "SI maslahatchi: SI balansi tugadi, balans to‘ldirilgunga qadar savollar menejerga boradi.",
  },
  slow: {
    ru: "ИИ-консультант не ответил: лимит частоты вызовов или слишком долгий поиск.",
    kk: "ЖИ-кеңесші жауап бермеді: шақыру жиілігі шегі немесе іздеу тым ұзақ болды.",
    en: "The AI consultant did not answer: call-rate limit or the search took too long.",
    uz: "SI maslahatchi javob bermadi: chaqiruvlar chastotasi chegarasi yoki qidiruv juda uzoq cho‘zildi.",
  },
  price: {
    ru: "Консультант назвал цену или стоимость доставки не из каталога и условий продавца, ответ заменён.",
    kk: "Кеңесші бағаны немесе жеткізу құнын каталогтан және сатушы шарттарынан тыс атады, жауап ауыстырылды.",
    en: "The consultant quoted a price or delivery cost that is not from the catalog or the seller's terms; the reply was replaced.",
    uz: "Maslahatchi narxni yoki yetkazib berish narxini katalog va sotuvchi shartlaridan tashqari aytdi, javob almashtirildi.",
  },
  injection: {
    ru: "Сообщение похоже на попытку управлять ботом.",
    kk: "Хабарлама ботты басқаруға әрекет сияқты.",
    en: "The message looks like an attempt to control the bot.",
    uz: "Xabar botni boshqarishga urinishga o‘xshaydi.",
  },
  wholesale: {
    ru: "Оптовый запрос: условий опта у консультанта нет, диалог передан вам.",
    kk: "Көтерме сұрау: кеңесшіде көтерме шарттары жоқ, диалог сізге берілді.",
    en: "Wholesale request: the consultant has no wholesale terms, the conversation is passed to you.",
    uz: "Ulgurji so‘rov: maslahatchida ulgurji shartlar yo‘q, suhbat sizga uzatildi.",
  },
  failure: {
    ru: "Сбой консультанта.",
    kk: "Консультант сәтсіздігі.",
    en: "Consultant failure.",
    uz: "Maslahatchi nosozligi.",
  },
};
const WROTE: Record<Locale, string> = {
  ru: "Клиент написал",
  kk: "Клиент жазды",
  en: "The customer wrote",
  uz: "Mijoz yozdi",
};

/** Сводка передачи менеджеру на языке продавца: причина + «Клиент написал: «…»». */
export function handoffSummary(locale: Locale, note: Note, incoming: string): string {
  return `${NOTES[note][locale]} ${WROTE[locale]}: «${incoming.slice(0, 200)}»`;
}
