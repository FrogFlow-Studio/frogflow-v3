import type { OverduePolicy } from "@/core/billing/subscription";

/**
 * Пробный период на виду: сколько осталось и что напомнить продавцу. Чистые
 * функции — плашку в шапке админки рисует страница, напоминание шлёт крон
 * подписок (app/operator/trial-remind.server.ts), тесты проверяют даты.
 */

const DAY_MS = 86_400_000;

export type TrialState = {
  /** Последний день пробного периода включительно, YYYY-MM-DD. */
  until: string;
  /** Дней до последнего дня; 0 — сегодня последний день. */
  daysLeft: number;
};

/** Разница календарных дней b − a для дат YYYY-MM-DD. */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);
}

/**
 * Клиент сейчас в пробном периоде: он не кончился и подписка не продлена
 * дальше него (оплата продлевает срок за trial_until — тогда пробный уже позади).
 * today — день по часовому поясу магазина.
 */
export function trialState(
  billing: { trial_until?: string } | undefined,
  expiresAt: string | null,
  today: string,
): TrialState | null {
  const until = billing?.trial_until;
  if (!until || until < today) return null;
  if (expiresAt && expiresAt.slice(0, 10) > until) return null;
  return { until, daysLeft: daysBetween(today, until) };
}

export type TrialStage = "d3" | "last";
/** За сколько дней до конца напоминаем первый раз. */
export const TRIAL_REMIND_DAYS = 3;

/**
 * Какое напоминание пора слать: «за 3 дня» (если крон пропустил сутки, то в
 * ближайший прогон за 1–3 дня) и «в последний день». Уже отправленное — null.
 */
export function dueStage(daysLeft: number, sent: readonly string[]): TrialStage | null {
  if (daysLeft === 0) return sent.includes("last") ? null : "last";
  if (daysLeft >= 1 && daysLeft <= TRIAL_REMIND_DAYS) return sent.includes("d3") ? null : "d3";
  return null;
}

/** Что будет после окончания — ровно то, что делает обход подписок (billing.server.sweepSubscriptions). */
export function afterTrial(policy: OverduePolicy): { mode: "warn" | "suspend"; graceDays: number } {
  return { mode: policy.on_overdue, graceDays: policy.grace_days };
}
