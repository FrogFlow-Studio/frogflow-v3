/**
 * Сбой базы или внешнего сервиса с русским пояснением для журнала и Sentry.
 * Отдельный класс, а не `new Error`: обычный Error с русским текстом экран
 * считает отказом человеку и показывает как есть (lib/server-fn-errors), а
 * в тексте сбоя — сообщение PostgREST с именами таблиц и ограничений.
 * ServerFailure идёт как сбой: на экране общая фраза, подробности в Sentry.
 */
export class ServerFailure extends Error {
  override name = "ServerFailure";
}

export function serverFailure(message: string): Error {
  return new ServerFailure(message);
}
