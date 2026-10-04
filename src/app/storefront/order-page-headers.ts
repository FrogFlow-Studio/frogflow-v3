/**
 * Заголовки страницы заказа по ссылке (/s/<магазин>/order/<номер>?t=…): адрес со
 * ссылкой-ключом не попадает в поиск, в Referer при переходе на оплату и отслеживание
 * и в общий кэш.
 */
export const ORDER_PAGE_HEADERS: Record<string, string> = {
  "X-Robots-Tag": "noindex, nofollow",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store",
};
