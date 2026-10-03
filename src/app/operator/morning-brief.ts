import { escapeHtml } from "@/channels/telegram/copy";
import type { ClientView } from "./operator.server";

/**
 * Утренняя сводка оператору: кому позвонить сегодня. Чистая часть — отбор
 * клиентов и текст; отправка и отметка «один раз в день» — в
 * `morning-brief.server.ts`.
 */
export const MORNING_HOUR = 8;
/** Telegram режет сообщение на 4096 знаках; клиентов сверх этого числа — строкой «и ещё N». */
const MAX_LINES = 25;

type Row = { id: string; name: string; reasons: string[]; risk: number };

export function morningRows(
  clients: readonly Pick<ClientView, "id" | "name" | "pulse" | "subscription" | "health">[],
): Row[] {
  const rows: Row[] = [];
  for (const c of clients) {
    const reasons: string[] = [];
    let risk = 0;
    const p = c.pulse;
    if (p?.quiet) {
      risk += p.risk;
      if (p.ordersDropped)
        reasons.push(`заказы ${p.recent} против ${p.previous} (${p.changePct}%)`);
      if (p.noLogin)
        reasons.push(
          p.daysSinceLogin === null
            ? "продавец не заходил 90+ дней"
            : `продавец не заходил ${p.daysSinceLogin} дн`,
        );
    }
    const s = c.subscription;
    if (s.state === "overdue" || s.state === "grace_over") {
      risk += 100;
      reasons.push(`подписка просрочена на ${Math.abs(s.daysLeft ?? 0)} дн`);
    } else if (s.state === "expiring") {
      risk += 40;
      reasons.push(`подписка истекает через ${Math.max(0, s.daysLeft ?? 0)} дн`);
    }
    if (c.health && !c.health.ok) {
      risk += 120;
      reasons.push(`сбой: ${(c.health.error ?? "бот не отвечает").slice(0, 120)}`);
    }
    if (reasons.length) rows.push({ id: c.id, name: c.name, reasons, risk });
  }
  return rows.sort((a, b) => b.risk - a.risk || a.name.localeCompare(b.name, "ru"));
}

export const PULSE_UNREAD_LINE = "⚠️ пульс клиентов не прочитан — затихших не видно";

/** Пульс не прочитан ни у одного клиента v2 (loadPulse упал): «затихших нет» тут не утверждаем. */
export function pulseUnread(clients: readonly Pick<ClientView, "pulse">[]): boolean {
  return clients.length > 0 && clients.every((c) => !c.pulse);
}

/** null — звонить некому, сообщение не шлём. */
export function morningText(rows: Row[], base: string, pulseMissing = false): string | null {
  if (rows.length === 0 && !pulseMissing) return null;
  const lines = rows
    .slice(0, MAX_LINES)
    .map(
      (r) =>
        `• <a href="${base}/operator/clients/${r.id}">${escapeHtml(r.name)}</a> — ${r.reasons
          .map(escapeHtml)
          .join("; ")}`,
    );
  if (rows.length > MAX_LINES) lines.push(`…и ещё ${rows.length - MAX_LINES}`);
  if (pulseMissing) lines.push(PULSE_UNREAD_LINE);
  return `☀️ <b>Кому позвонить сегодня</b> (${rows.length})\n\n${lines.join("\n")}`;
}

/** Дата и час по поясу платформы: день — ключ отметки «уже слали». */
export function localDayHour(now: Date, timeZone: string): { day: string; hour: number } {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(now)
      .map((x) => [x.type, x.value]),
  );
  return { day: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) };
}
