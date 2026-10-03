import { pageAll } from "@/core/db/page";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { type Ticket, type TicketStatus, TICKET_PREFIX, rowToTicketForJobs } from "./tickets";

/**
 * «Мои обращения» покупателя: номер, статус и тема его собственных обращений
 * (бот, Direct/WhatsApp, Mini App). Выбор — только по id самого покупателя,
 * который каналы берут из подписи (initData, Telegram, Zernio), не из запроса.
 * Заметки команды и ответственный покупателю не показываются.
 */
export const MY_TICKETS_SHOWN = 10;

export type MyTicket = {
  number: number;
  status: TicketStatus;
  subject: string;
  /** Последнее движение по обращению (создание, дополнение, смена статуса). */
  updatedAt: string;
  rating: number | null;
};

export type MyTickets = {
  tickets: MyTicket[];
  /** Сколько более старых обращений не показано. */
  more: number;
  /** Есть открытое или «ждём покупателя» — в него можно дописать. */
  canAppend: boolean;
};

function lastMove(t: Ticket): string {
  return t.history.at(-1)?.at ?? t.createdAt;
}

export async function myTickets(ctx: TenantContext, telegramId: number): Promise<MyTickets> {
  const rows = await pageAll(
    (from, to) =>
      ctx.db
        .from("zernio_logs")
        .select("id, status, payload, created_at")
        .like("event_id", `${TICKET_PREFIX}%`)
        .contains("payload", { telegram_id: telegramId })
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .range(from, to),
    "Мои обращения",
  );
  // Страховка поверх фильтра базы: чужое обращение сюда не попадёт ни при каком запросе.
  const all = rowToTicketForJobs(rows).filter((t) => t.telegramId === telegramId);
  return {
    tickets: all.slice(0, MY_TICKETS_SHOWN).map((t) => ({
      number: t.number,
      status: t.status,
      subject: t.subject.slice(0, 120),
      updatedAt: lastMove(t),
      rating: t.rating,
    })),
    more: Math.max(0, all.length - MY_TICKETS_SHOWN),
    canAppend: all.some((t) => t.status !== "closed"),
  };
}

/** Слова Direct/WhatsApp, которыми покупатель просит свои обращения (сравнивается всё сообщение целиком). */
const MY_TICKETS_WORDS = new Set([
  "мои обращения",
  "обращения",
  "моё обращение",
  "мое обращение",
  "статус обращения",
  "менің өтініштерім",
  "өтініштер",
  "өтініш күйі",
  "my requests",
  "my tickets",
  "request status",
  "murojaatlarim",
  "murojaatlar",
  "murojaat holati",
]);

export function isMyTicketsWord(text: string): boolean {
  const n = text
    .trim()
    .toLowerCase()
    .replace(/[.!?,;:]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return MY_TICKETS_WORDS.has(n);
}
