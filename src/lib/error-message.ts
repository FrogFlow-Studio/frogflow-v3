/**
 * Текст ошибки из `catch (e: unknown)`, как errorMessage в v1.
 *
 * Вызов серверной функции иногда отклоняется не Error, а обычным объектом
 * (зависит от того, где порвалась цепочка RPC), и `String(e)` даёт
 * бесполезное «[object Object]». Без зависимостей — годится и для браузера.
 */
export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object") {
    const withFields = e as { message?: unknown; error?: unknown };
    if (typeof withFields.message === "string" && withFields.message) return withFields.message;
    if (typeof withFields.error === "string" && withFields.error) return withFields.error;
    try {
      return JSON.stringify(e);
    } catch {
      // Циклическая структура — дальше String(e).
    }
  }
  return String(e);
}
