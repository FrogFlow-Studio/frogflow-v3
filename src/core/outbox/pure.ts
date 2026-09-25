/**
 * Повторы исходящих — чистые правила. Telegram и Zernio отвечают отказом по
 * сотне причин, из которых половина проходит сама (сеть, 429, «бот
 * перегружен»), а вторая — нет (покупатель заблокировал бота, диалог
 * закрыт). Пять попыток с растущей паузой: первая через минуту, последняя
 * через три часа; после — «не доставлено», продавец видит в админке.
 */
export const OUTBOX_MAX_ATTEMPTS = 5;
/** Пауза перед попыткой N (после N-й неудачи), минуты. */
export const OUTBOX_BACKOFF_MIN = [1, 5, 15, 60, 180] as const;

export function outboxDead(attempts: number): boolean {
  return attempts >= OUTBOX_MAX_ATTEMPTS;
}

/** Когда пробовать снова после `attempts` неудач; null — попытки кончились. */
export function outboxNextAt(attempts: number, now: Date): Date | null {
  if (outboxDead(attempts)) return null;
  const minutes = OUTBOX_BACKOFF_MIN[Math.min(attempts, OUTBOX_BACKOFF_MIN.length) - 1] ?? 1;
  return new Date(now.getTime() + minutes * 60_000);
}

/** Отказы, при которых повторять бессмысленно: адресат недоступен навсегда. */
const PERMANENT = [
  /bot was blocked by the user/i,
  /user is deactivated/i,
  /chat not found/i,
  /bots can't send messages to bots/i,
  /have no rights to send/i,
  /Forbidden/i,
];

export function outboxPermanentFailure(error: string | null | undefined): boolean {
  return Boolean(error) && PERMANENT.some((re) => re.test(error!));
}
