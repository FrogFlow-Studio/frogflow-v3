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

type Note = "accounting" | "balance" | "limit" | "catalog" | "failure";
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
