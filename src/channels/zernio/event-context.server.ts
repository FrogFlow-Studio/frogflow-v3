import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";

/**
 * Контекст обрабатываемого события Zernio — ради заголовка `Idempotency-Key`
 * при отправке. Доставка у Zernio at-least-once: повтор того же события
 * обязан дать тот же ключ (Zernio вернёт исходный ответ, а не второе
 * сообщение покупателю), разные события — разные ключи (законный повтор
 * «не понял, повторите» не должен глотаться как дубль). Отправка зовётся из
 * многих мест обработчика, поэтому идентификатор выставляется один раз на
 * входе, а не протаскивается параметром.
 */
const store = new AsyncLocalStorage<{ eventId: string }>();

export function runWithZernioEvent<T>(eventId: string | null, task: () => Promise<T>): Promise<T> {
  if (!eventId) return task();
  return store.run({ eventId }, task);
}

/** Событие Zernio, в обработке которого идёт код, — ключ строки журнала ответов. */
export function currentZernioEventId(): string | null {
  return store.getStore()?.eventId ?? null;
}

/**
 * Ключ одной отправки: область + тело. Область — явная (`outbox:<id>`,
 * `chat:<id черновика>`, `deliver:<позиция>`) или событие Zernio, в
 * обработке которого идёт отправка. Без области ключа нет: одинаковый
 * текст, отправленный продавцом дважды намеренно, подавлять нельзя.
 * Zernio хранит ключ сутки и только для успешных ответов, поэтому повтор
 * после 5xx уходит заново, а повтор после нашего таймаута при уже
 * принятой отправке возвращает исходный ответ, а не второе сообщение.
 */
export function idempotencyKeyFor(body: unknown, scope?: string): string | undefined {
  const key = scope ?? store.getStore()?.eventId;
  if (!key) return undefined;
  return createHash("sha256")
    .update(`${key}:${JSON.stringify(body)}`)
    .digest("hex");
}
