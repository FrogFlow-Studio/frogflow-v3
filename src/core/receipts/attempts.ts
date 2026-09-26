import type { DialogState } from "@/core/customers/customers";

/**
 * Лимит автопроверок чека на покупателя. Без него «не чек» → «пришлите заново»
 * можно гонять по кругу, и каждый круг — платный вызов Vision из месячного
 * лимита магазина. Сверх лимита чек не читаем, а отдаём продавцу руками.
 */
export const RECEIPT_CHECKS_PER_ORDER = 3;
export const RECEIPT_CHECKS_PER_DAY = 10;

export const RECEIPT_CHECKS_KEY = "receipt_checks";

type Counter = { day: string; n: number; order_id: number; order_n: number };

const today = (now: Date) => now.toISOString().slice(0, 10);

function readCounter(state: DialogState, now: Date): Counter {
  const raw = state[RECEIPT_CHECKS_KEY];
  const c = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
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
  state: DialogState,
  orderId: number,
  now = new Date(),
): "order" | "day" | null {
  const c = readCounter(state, now);
  if (c.order_id === orderId && c.order_n >= RECEIPT_CHECKS_PER_ORDER) return "order";
  if (c.n >= RECEIPT_CHECKS_PER_DAY) return "day";
  return null;
}

/** Состояние после ещё одной проверки по заказу orderId. */
export function withReceiptCheck(
  state: DialogState,
  orderId: number,
  now = new Date(),
): DialogState {
  const c = readCounter(state, now);
  const next: Counter = {
    day: c.day,
    n: c.n + 1,
    order_id: orderId,
    order_n: c.order_id === orderId ? c.order_n + 1 : 1,
  };
  return { ...state, [RECEIPT_CHECKS_KEY]: next };
}
