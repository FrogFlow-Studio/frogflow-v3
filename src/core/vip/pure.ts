/**
 * Решения VIP-подписки без побочных действий: даты и числа. Заведено в v1
 * после прод-инцидента — инвайт-ссылка, чей expire_date считался инлайн,
 * уходила клиенту уже просроченной в тест-режиме (минуты вместо дней).
 */

/** Тарифы часто не задают duration_minutes — единственный фолбэк для тест-режима. */
export const TEST_MODE_DEFAULT_MINUTES = 5;

/** Метки в admin_note: первое и второе напоминание уже отправлены. */
export const WARN_STAGE_1 = "warned";
export const WARN_STAGE_2 = "warned2";

const INVITE_MIN_WINDOW_MS = 10 * 60_000;
const INVITE_MAX_WINDOW_MS = 24 * 60 * 60_000;

/**
 * Инвайт должен прожить достаточно, чтобы по нему успели перейти (не короче
 * 10 минут), и не дольше суток — одноразовая ссылка, привязанная к
 * многомесячной подписке, оставалась рабочей месяцами.
 */
export function inviteExpireDate(expiresAt: Date, now: number = Date.now()): number {
  const floor = now + INVITE_MIN_WINDOW_MS;
  const ceiling = now + INVITE_MAX_WINDOW_MS;
  return Math.floor(Math.min(Math.max(expiresAt.getTime(), floor), ceiling) / 1000);
}

/** В тест-режиме срок тарифа считается в минутах, а не в днях. */
export function addTariffDuration(
  base: Date,
  tariff: { duration_minutes?: number | null; duration_days?: number | null } | null,
  isTest: boolean,
): Date {
  const expiresAt = new Date(base);
  if (isTest) {
    expiresAt.setMinutes(
      expiresAt.getMinutes() + (tariff?.duration_minutes || TEST_MODE_DEFAULT_MINUTES),
    );
  } else {
    expiresAt.setDate(expiresAt.getDate() + (tariff?.duration_days || 30));
  }
  return expiresAt;
}

/** Тот же тест-режим — минуты вместо дней — для окон предупреждений крона. */
export function addWarnOffset(base: Date, amount: number, isTest: boolean): Date {
  const d = new Date(base);
  if (isTest) d.setMinutes(d.getMinutes() + amount);
  else d.setDate(d.getDate() + amount);
  return d;
}

export type WarnWindows = { warnDays: number; warnDays2: number };

/**
 * Окна предупреждений валидируются здесь, а не только в форме: значение
 * могло быть сохранено раньше. Второе окно обязано быть строго ближе
 * первого — иначе оба сработают в одном тике.
 */
export function resolveWarnWindows(rawWarnDays: string, rawWarnDays2: string): WarnWindows {
  let warnDays = parseInt(rawWarnDays || "3", 10);
  let warnDays2 = parseInt(rawWarnDays2 || "1", 10);
  if (!Number.isFinite(warnDays) || warnDays < 1) warnDays = 3;
  if (!Number.isFinite(warnDays2) || warnDays2 < 1) warnDays2 = 1;
  if (warnDays2 >= warnDays) warnDays2 = Math.max(1, warnDays - 1);
  return { warnDays, warnDays2 };
}

/** По одной строке на пользователя — с самой поздней датой истечения (страховка от дублей). */
export function pickLatestPerUser<
  T extends { telegram_id: number | null; expires_at: string | null },
>(rows: T[] | null): T[] {
  const best = new Map<number, T>();
  for (const sub of rows ?? []) {
    const tid = sub.telegram_id as number;
    const prev = best.get(tid);
    if (!prev || new Date(sub.expires_at as string) > new Date(prev.expires_at as string)) {
      best.set(tid, sub);
    }
  }
  return [...best.values()];
}

export type VipExtensionDecision = {
  /** Подписка была не-активной или просроченной на момент запроса. */
  wasInactive: boolean;
  /** Новая дата истечения после применения ±дней. */
  baseSafe: Date;
  /** Уменьшение утащило дату в прошлое — подписку нужно завершить, а не продлить. */
  shortenedPast: boolean;
};

/** Арифметика «±дни»: от текущего срока или от «сейчас», если подписка уже не активна. */
export function resolveVipExtension(
  sub: { status: string; expires_at: string },
  days: number,
  now: Date = new Date(),
): VipExtensionDecision {
  const pastDue = sub.status === "active" && new Date(sub.expires_at).getTime() <= now.getTime();
  const wasInactive = sub.status !== "active" || pastDue;
  const base = wasInactive ? new Date(now) : new Date(sub.expires_at);
  const baseSafe = base.getTime() < now.getTime() && days > 0 ? new Date(now) : new Date(base);
  baseSafe.setDate(baseSafe.getDate() + days);
  const shortenedPast = days < 0 && baseSafe.getTime() <= now.getTime();
  return { wasInactive, baseSafe, shortenedPast };
}

/** Ошибка Telegram означает, что пользователя и так нет в группе. */
export function isAlreadyNotInChat(description?: string): boolean {
  if (!description) return false;
  const d = description.toLowerCase();
  return (
    d.includes("user_not_participant") ||
    d.includes("user not found") ||
    d.includes("chat_not_found") ||
    d.includes("participant_id_invalid") ||
    d.includes("user_id_invalid")
  );
}

/** Состоит в группе (в том числе с ограничениями). */
export function memberStatusIsInGroup(status: string | undefined | null): boolean {
  return (
    status === "member" ||
    status === "administrator" ||
    status === "creator" ||
    status === "restricted"
  );
}

/** Создатель и админы — подписка не нужна, крон не исключает. */
export function memberStatusExempt(status: string | undefined | null): boolean {
  return status === "creator" || status === "administrator";
}

/** Подстановка `{token}` в переведённую строку. */
export function fmt(template: string, vars: Record<string, string>): string {
  return Object.entries(vars).reduce((acc, [k, v]) => acc.replaceAll(`{${k}}`, v), template);
}

/** Дата и время для покупателя: 21.09.2026 15:04 в часовом поясе клиента. */
export function formatDateTime(value: string | Date, timeZone: string): string {
  const d = typeof value === "string" ? new Date(value) : value;
  return d.toLocaleString("ru-RU", {
    timeZone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
