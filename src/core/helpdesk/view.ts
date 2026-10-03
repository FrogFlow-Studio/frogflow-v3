import type { TicketHistory } from "./tickets";

/** Фильтры страницы «Обращения»: по умолчанию — открытые. */
export const TICKET_FILTERS = ["open", "waiting", "closed", "all"] as const;
export type TicketFilter = (typeof TICKET_FILTERS)[number];

type T = (key: string, vars?: Record<string, string>) => string;

/**
 * Строка истории обращения для людей: «статус: Закрыто», «ответственный:
 * Анна (anna)», «заметка — текст». Действия хранятся как `status:closed`,
 * `assignee:anna`; кто сделал — `admin:<логин>` или `customer`.
 */
export function historyLine(
  h: TicketHistory,
  t: T,
  who: (username: string | null) => string,
): string {
  const [kind, value = ""] = h.action.split(/:(.*)/s);
  const actor = h.actor === "customer" ? t("tickets.h.customer") : h.actor.replace(/^admin:/, "");
  let what: string;
  if (kind === "status" && value)
    what = t("tickets.h.status", {
      status: t(`tickets.status.${value === "pending" ? "waiting" : value}`),
    });
  else if (kind === "assignee")
    what = t("tickets.h.assignee", { who: who(value === "-" ? null : value) });
  else if (kind === "rating") what = t("tickets.h.rating", { score: value });
  else if (kind === "opened" || kind === "message" || kind === "note")
    what = t(`tickets.h.${kind}`);
  else what = h.action;
  return `${actor}: ${what}${h.note ? ` — ${h.note}` : ""}`;
}
