import { localToInstant, type Timeline } from "./cohort";
import { sortLives, type Live } from "./live";

/** Ссылка открывается за столько до начала. */
export const LIVE_LINK_LEAD_MS = 15 * 60_000;
/** Сколько после начала эфир считается идущим: длительность не хранится, берём запас. */
export const LIVE_RUNNING_MS = 3 * 3_600_000;

export type LiveStatus = "upcoming" | "open" | "past";

/** Эфир глазами ученика с действующим доступом. */
export type LiveView = {
  id: string;
  title: string;
  /** Местное время магазина «YYYY-MM-DDTHH:MM» (для показа) и момент начала (ISO). */
  at: string;
  startsAt: string;
  status: LiveStatus;
  /** Только у идущего или скоро начинающегося (за 15 минут) — иначе null. */
  link: string | null;
};

/**
 * Расписание эфиров для ученика: ссылку получает только тот, у кого доступ
 * действует (тариф, срок), и только с `LIVE_LINK_LEAD_MS` до начала и пока
 * эфир идёт. Закончился доступ — эфиров не видно совсем. Чистая функция.
 */
export function liveSchedule(
  tl: Pick<Timeline, "cohort" | "expired">,
  tz: string,
  now: Date,
): LiveView[] {
  if (tl.expired) return [];
  return sortLives(tl.cohort?.lives ?? []).map((l: Live) => {
    const start = localToInstant(l.at, tz).getTime();
    const status: LiveStatus =
      now.getTime() < start - LIVE_LINK_LEAD_MS
        ? "upcoming"
        : now.getTime() < start + LIVE_RUNNING_MS
          ? "open"
          : "past";
    return {
      id: l.id,
      title: l.title,
      at: l.at,
      startsAt: new Date(start).toISOString(),
      status,
      link: status === "open" ? l.link : null,
    };
  });
}
