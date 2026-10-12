/**
 * Лимит автопроверок чека на покупателя. Без него «не чек» → «пришлите заново»
 * можно гонять по кругу, и каждый круг — платный вызов ИИ из месячного
 * лимита магазина. Сверх лимита чек не читаем, а отдаём продавцу руками.
 *
 * Счётчик — отдельная строка app_settings на покупателя, а не поле
 * bot_users.state: состояние диалога переписывается целиком, и альбом из
 * десяти фото (десять параллельных обработчиков) затирал бы прибавки друг
 * друга. Строка пишется updateSettingAtomic — сравнение и замена.
 */
export const RECEIPT_CHECKS_PER_ORDER = 3;
export const RECEIPT_CHECKS_PER_DAY = 10;

export const RECEIPT_CHECKS_PREFIX = "receipt_checks:";

export function receiptChecksKey(userKey: string): string {
  return `${RECEIPT_CHECKS_PREFIX}${userKey}`;
}

/** День последней проверки из значения счётчика; null — значение не счётчик. */
export function receiptChecksDay(raw: string | null): string | null {
  try {
    const day = (JSON.parse(raw || "null") as { day?: unknown } | null)?.day;
    return typeof day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
  } catch {
    return null;
  }
}

type Counter = { day: string; n: number; order_id: number; order_n: number };

const today = (now: Date) => now.toISOString().slice(0, 10);

function readCounter(raw: string | null, now: Date): Counter {
  let c: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(raw || "{}") as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
      c = parsed as Record<string, unknown>;
  } catch {
    // битое значение — как пустой счётчик
  }
  const day = today(now);
  const num = (v: unknown) => Math.max(0, Math.floor(Number(v) || 0));
  return {
    day,
    n: c.day === day ? num(c.n) : 0,
    order_id: num(c.order_id),
    order_n: num(c.order_n),
  };
}

/** Почему следующую проверку делать нельзя; null — можно. */
export function receiptCheckBlocked(
  raw: string | null,
  orderId: number,
  now = new Date(),
): "order" | "day" | null {
  const c = readCounter(raw, now);
  if (c.order_id === orderId && c.order_n >= RECEIPT_CHECKS_PER_ORDER) return "order";
  if (c.n >= RECEIPT_CHECKS_PER_DAY) return "day";
  return null;
}

/** Значение счётчика после ещё одной проверки по заказу orderId. */
export function withReceiptCheck(raw: string | null, orderId: number, now = new Date()): string {
  const c = readCounter(raw, now);
  const next: Counter = {
    day: c.day,
    n: c.n + 1,
    order_id: orderId,
    order_n: c.order_id === orderId ? c.order_n + 1 : 1,
  };
  return JSON.stringify(next);
}
