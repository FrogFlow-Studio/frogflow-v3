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

/** Ключ одной отправки: событие + тело. Вне обработки события ключа нет — ручную отправку подавлять нельзя. */
export function idempotencyKeyFor(body: unknown): string | undefined {
  const context = store.getStore();
  if (!context) return undefined;
  return createHash("sha256")
    .update(`${context.eventId}:${JSON.stringify(body)}`)
    .digest("hex");
}
