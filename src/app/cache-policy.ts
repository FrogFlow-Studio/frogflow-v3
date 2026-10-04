/**
 * Политика кеширования ответов (С4). Что не названо явно, не кешируется: корневой маршрут отдаёт
 * `private, no-store`, поэтому страница, которую забыли в списке, остаётся закрытой. Общим для
 * всех покупателей (каталог площадки, витрина без входа, страницы-визитки) разрешён только короткий
 * общий кеш: цена и остаток на витрине устаревают не дольше минуты, правки продавца видны быстро.
 * Всё, что зависит от входа, корзины, заказа по ссылке с токеном и жалоб, остаётся `no-store`.
 */
export const NO_STORE = "private, no-store";
export const PUBLIC_PAGE = "public, max-age=0, s-maxage=60, stale-while-revalidate=300";

export const privateHeaders = (): Record<string, string> => ({ "Cache-Control": NO_STORE });
export const publicHeaders = (): Record<string, string> => ({ "Cache-Control": PUBLIC_PAGE });

/**
 * Ответ API без явной политики получает `no-store`. Заголовки Response.redirect() неизменяемы,
 * поэтому ответ пересобирается; тело и статус остаются прежними.
 */
export function withNoStore(res: Response): Response {
  if (res.headers.has("cache-control")) return res;
  const headers = new Headers(res.headers);
  headers.set("cache-control", NO_STORE);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}
