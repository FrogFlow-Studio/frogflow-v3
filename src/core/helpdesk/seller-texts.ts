import type { Locale } from "@/core/i18n/locale";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { sellerLocale } from "@/core/catalog/low-stock";

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
  escalatedTitle: (waited: string) => string;
  ticketTitle: (n: number, waited: string) => string;
  assignee: string;
  noAssignee: string;
  reply: string;
};

const WORDS: Record<Locale, Words> = {
  ru: {
    chatTitle: (w) => `Покупатель ждёт ответа ${w}`,
    escalatedTitle: (w) => `Диалог так и остался без ответа: покупатель ждёт ${w}`,
    ticketTitle: (n, w) => `Обращение #${n} без ответа ${w}`,
    assignee: "Ответственный",
    noAssignee: "Ответственный не назначен",
    reply: "Ответьте в разделе «Чат»",
  },
  kk: {
    chatTitle: (w) => `Сатып алушы жауапты ${w} күтуде`,
    escalatedTitle: (w) => `Диалог жауапсыз қалды: сатып алушы ${w} күтуде`,
    ticketTitle: (n, w) => `№${n} өтініш ${w} жауапсыз`,
    assignee: "Жауапты",
    noAssignee: "Жауапты тағайындалмаған",
    reply: "«Чат» бөлімінде жауап беріңіз",
  },
  en: {
    chatTitle: (w) => `Customer has been waiting for a reply for ${w}`,
    escalatedTitle: (w) => `Still no reply in this chat: the customer has been waiting for ${w}`,
    ticketTitle: (n, w) => `Request #${n} unanswered for ${w}`,
    assignee: "Assigned to",
    noAssignee: "No one assigned",
    reply: "Reply in the “Chat” section",
  },
  uz: {
    chatTitle: (w) => `Xaridor javobni ${w} kutmoqda`,
    escalatedTitle: (w) => `Suhbat javobsiz qoldi: xaridor ${w} kutmoqda`,
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

/** Второй шаг напоминания — владельцу: после первого напоминания диалог так и остался без ответа. */
export function unansweredEscalationText(locale: Locale, waited: string, c: WaitingCard): string {
  const w = WORDS[locale];
  return body(w, c, w.escalatedTitle(waited));
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

const NOTICE: Record<
  Locale,
  { created: (n: number) => string; appended: (n: number) => string; tail: string }
> = {
  ru: {
    created: (n) => `Новое обращение #${n}`,
    appended: (n) => `Дополнение к обращению #${n}`,
    tail: "Ответить — раздел «Чат», статус — «Обращения» в панели.",
  },
  kk: {
    created: (n) => `Жаңа өтініш №${n}`,
    appended: (n) => `№${n} өтінішке қосымша`,
    tail: "Жауап беру — панельдегі «Чат» бөлімі, күйі — «Өтініштер» бөлімі.",
  },
  en: {
    created: (n) => `New request #${n}`,
    appended: (n) => `Addition to request #${n}`,
    tail: "Reply in “Chat”, change the status in “Requests” in the panel.",
  },
  uz: {
    created: (n) => `Yangi murojaat #${n}`,
    appended: (n) => `#${n} murojaatga qoʻshimcha`,
    tail: "Javob berish — panelning «Chat» boʻlimi, holati — «Murojaatlar» boʻlimi.",
  },
};

/** Продавцу: покупатель завёл обращение или дописал в открытое. `who` и `text` уже экранированы. */
export function ticketNoticeText(
  locale: Locale,
  created: boolean,
  number: number,
  who: string,
  text: string,
): string {
  const w = NOTICE[locale];
  return `📨 <b>${created ? w.created(number) : w.appended(number)}</b>\n${who}\n\n${text}\n\n${w.tail}`;
}

/**
 * Язык уведомления об обращении. Обращение уже записано, а сообщение продавцу
 * не должно пропасть из-за сбоя чтения настройки языка: при сбое — русский, в журнал.
 */
export async function noticeLocale(ctx: TenantContext): Promise<Locale> {
  try {
    return await sellerLocale(ctx);
  } catch (e) {
    console.error(`[ticket-notice:${ctx.tenant.id}] язык продавца не прочитан:`, e);
    return "ru";
  }
}
