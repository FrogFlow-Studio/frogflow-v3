import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Отметка «первая отправка наружу начата» для обработки, которую могут
 * повторить. Событие Zernio, брошенное на полпути (функция умерла), добор
 * повторяет целиком; если к тому моменту покупателю уже ушёл ответ
 * консультанта или продавцу — уведомление в Telegram, повтор отправил бы
 * их второй раз (ответ LLM при повторе другой, ключ идемпотентности не
 * спасёт). Поэтому перед первой отправкой обработка отмечает это на строке
 * журнала, и добор повторяет только события без отметки.
 *
 * Отправители (Zernio, Telegram, почта) зовут `beforeExternalEffect()`
 * перед запросом; вне `runNotingEffects` это ничего не делает.
 */
type Journal = { before: () => Promise<void>; pending?: Promise<void> };

const store = new AsyncLocalStorage<Journal>();

export function runNotingEffects<T>(
  before: () => Promise<void>,
  task: () => Promise<T>,
): Promise<T> {
  return store.run({ before }, task);
}

/** Отметка пишется один раз на обработку; параллельные отправки ждут ту же запись. */
export async function beforeExternalEffect(): Promise<void> {
  const journal = store.getStore();
  if (!journal) return;
  journal.pending ??= journal.before().catch((e) => {
    console.error("[effects] отметка отправки не записана", e);
  });
  await journal.pending;
}
