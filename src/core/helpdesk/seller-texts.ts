import type { Locale } from "@/core/i18n/locale";

/**
 * Сообщения продавцу о том, что покупатель или обращение ждёт ответа
 * (кроны runUnansweredChats и runOverdueTickets). Язык — sellerLocale
 * (core/catalog/low-stock). Имена, темы и ссылки экранирует и подставляет
 * вызывающий: здесь только слова.
 */
const UNITS: Record<Locale, { min: string; h: string }> = {
  ru: { min: "мин", h: "ч" },
  kk: { min: "мин", h: "сағ" },
  en: { min: "min", h: "h" },
  uz: { min: "daq", h: "soat" },
};

/** «12 мин», «2 ч 5 мин» — сколько покупатель ждёт. */
export function waitedText(locale: Locale, since: string, now = Date.now()): string {
  const u = UNITS[locale];
  const min = Math.max(1, Math.round((now - Date.parse(since)) / 60_000));
  if (min < 60) return `${min} ${u.min}`;
  const h = Math.floor(min / 60);
  const rest = min % 60;
  return rest ? `${h} ${u.h} ${rest} ${u.min}` : `${h} ${u.h}`;
}

type Words = {
  chatTitle: (waited: string) => string;
  ticketTitle: (n: number, waited: string) => string;
  assignee: string;
  noAssignee: string;
  reply: string;
};

const WORDS: Record<Locale, Words> = {
  ru: {
    chatTitle: (w) => `Покупатель ждёт ответа ${w}`,
    ticketTitle: (n, w) => `Обращение #${n} без ответа ${w}`,
    assignee: "Ответственный",
    noAssignee: "Ответственный не назначен",
    reply: "Ответьте в разделе «Чат»",
  },
  kk: {
    chatTitle: (w) => `Сатып алушы жауапты ${w} күтуде`,
    ticketTitle: (n, w) => `№${n} өтініш ${w} жауапсыз`,
    assignee: "Жауапты",
    noAssignee: "Жауапты тағайындалмаған",
    reply: "«Чат» бөлімінде жауап беріңіз",
  },
  en: {
    chatTitle: (w) => `Customer has been waiting for a reply for ${w}`,
    ticketTitle: (n, w) => `Request #${n} unanswered for ${w}`,
    assignee: "Assigned to",
    noAssignee: "No one assigned",
    reply: "Reply in the “Chat” section",
  },
  uz: {
    chatTitle: (w) => `Xaridor javobni ${w} kutmoqda`,
    ticketTitle: (n, w) => `#${n} murojaat ${w} javobsiz`,
    assignee: "Mas'ul",
    noAssignee: "Mas'ul tayinlanmagan",
    reply: "«Chat» boʻlimida javob bering",
  },
};

export type WaitingCard = {
  /** Уже экранированные части (HTML Telegram). */
  who: string;
  assignee: string | null;
  preview: string;
  link: string;
};

function body(w: Words, c: WaitingCard, head: string): string {
  return [
    `⏳ <b>${head}</b>`,
    c.who,
    c.assignee ? `${w.assignee}: ${c.assignee}` : w.noAssignee,
    `💬 ${c.preview}`,
    "",
    `${w.reply}: ${c.link}`,
  ].join("\n");
}

export function unansweredChatText(locale: Locale, waited: string, c: WaitingCard): string {
  const w = WORDS[locale];
  return body(w, c, w.chatTitle(waited));
}

export function overdueTicketText(
  locale: Locale,
  number: number,
  waited: string,
  c: WaitingCard,
): string {
  const w = WORDS[locale];
  return body(w, c, w.ticketTitle(number, waited));
}
