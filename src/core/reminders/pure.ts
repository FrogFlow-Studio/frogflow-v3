/** Чистые решения «пора ли напомнить» — без базы. */

/**
 * Брошенная корзина: прошло не меньше reminderHours с последней активности,
 * и про именно эту (не тронутую с тех пор) корзину ещё не напоминали.
 * Новая позиция сдвигает активность вперёд и снова разрешает напоминание.
 */
export function shouldSendCartReminder(
  cartLastActivity: Date,
  now: Date,
  reminderHours: number,
  lastReminderSentAt: Date | null,
): boolean {
  if (!(reminderHours > 0)) return false;
  const elapsedMs = now.getTime() - cartLastActivity.getTime();
  if (elapsedMs < reminderHours * 60 * 60 * 1000) return false;
  if (lastReminderSentAt && lastReminderSentAt.getTime() >= cartLastActivity.getTime())
    return false;
  return true;
}

/**
 * Напоминание о дате получения: дата ещё впереди, но не дальше 24 часов, и
 * напоминание ещё не уходило. Прошедшая дата — напоминать уже бесполезно.
 */
export function isFulfillmentReminderEligible(
  fulfillmentAt: Date,
  now: Date,
  alreadySentAt: Date | null,
): boolean {
  if (alreadySentAt) return false;
  const diff = fulfillmentAt.getTime() - now.getTime();
  return diff > 0 && diff <= 24 * 60 * 60 * 1000;
}

/** Порог из настройки: пусто/мусор → 6 часов, «0» — выключено. */
export function parseReminderHours(raw: string | null | undefined, fallback = 6): number {
  if (raw == null || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}
