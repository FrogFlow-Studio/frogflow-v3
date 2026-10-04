/**
 * Напоминания об эфире (Ш3): за сутки и за час до начала. Чистые правила —
 * когда какое пора слать и какой отметкой его закрывать.
 */
const MIN = 60_000;
export const LIVE_HOUR_MS = 60 * MIN;
export const LIVE_DAY_MS = 24 * 60 * MIN;

export type LiveRemindKind = "day" | "hour";

/**
 * Метка в записи прохождения. Включает время начала: перенесённый эфир
 * получает напоминания заново. Короткая — запись прохождения читают целиком.
 */
export function liveMark(liveId: string, at: string, kind: LiveRemindKind): string {
  return `${liveId.slice(0, 8)}${at.replace(/\D/g, "")}${kind === "day" ? "d" : "h"}`;
}

/**
 * Что пора слать по эфиру. За сутки — с отметки «осталось ≤ 24 ч» и только
 * днём по поясу магазина (ночью ждёт утра, пока до эфира больше часа); за
 * час — с отметки «осталось ≤ 60 мин», в любое время суток: эфир вот-вот
 * начнётся. После начала не шлём ничего. Напоминание за час закрывает и
 * суточное: поздно писать «через сутки» за 40 минут до эфира.
 */
export function liveReminderDue(
  startMs: number,
  nowMs: number,
  daytime: boolean,
  have: ReadonlySet<string>,
  marks: { day: string; hour: string },
): { kind: LiveRemindKind; mark: string[] } | null {
  const left = startMs - nowMs;
  if (left <= 0) return null;
  if (left <= LIVE_HOUR_MS)
    return have.has(marks.hour) ? null : { kind: "hour", mark: [marks.day, marks.hour] };
  if (left <= LIVE_DAY_MS && daytime)
    return have.has(marks.day) ? null : { kind: "day", mark: [marks.day] };
  return null;
}
