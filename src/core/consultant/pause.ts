import type { Tenant } from "@/core/tenant/types";

/**
 * Сколько ИИ-консультант молчит в диалоге, когда отвечает человек: передача
 * менеджеру, ответ продавца из «Чата» или прямо из Instagram/WhatsApp,
 * исчерпанный предел ИИ. Продавец выбирает в настройках консультанта
 * (`bots.settings.consultant_pause_hours`); 0 — «пока не верну сам».
 */
export const PAUSE_CHOICES = [1, 3, 12, 24, 0] as const;
export type PauseHours = (typeof PAUSE_CHOICES)[number];
export const DEFAULT_PAUSE_HOURS: PauseHours = 12;
/** «Пока не верну сам» — пауза на сто лет: isPaused и так сравнивает только время. */
const FOREVER_MS = 100 * 365 * 24 * 3600_000;

export function validPauseHours(v: unknown): PauseHours | undefined {
  return (PAUSE_CHOICES as readonly unknown[]).includes(v) ? (v as PauseHours) : undefined;
}

export function pauseHours(tenant: Pick<Tenant, "settings">): PauseHours {
  return validPauseHours(tenant.settings.consultant_pause_hours) ?? DEFAULT_PAUSE_HOURS;
}

export function pausedUntilIso(hours: PauseHours, now = Date.now()): string {
  return new Date(now + (hours === 0 ? FOREVER_MS : hours * 3600_000)).toISOString();
}

/** Пауза без срока: до неё больше года — это «пока не верну сам». */
export function isIndefinite(until: string | null | undefined, now = Date.now()): boolean {
  const t = Date.parse(until ?? "");
  return Number.isFinite(t) && t - now > 365 * 24 * 3600_000;
}

/** Хвост уведомления продавцу: «консультант в этом диалоге молчит …». */
export function pauseNoticeRu(hours: PauseHours): string {
  if (hours === 0) return "молчит, пока вы не вернёте диалог боту";
  if (hours === 1) return "молчит 1 час";
  if (hours === 3 || hours === 24) return `молчит ${hours} часа`;
  return `молчит ${hours} часов`;
}
