/** Подписанная ссылка заказа в браузере покупателя: после отказа оплаты картой Robokassa возвращает без неё. */
const tokenKey = (slug: string, id: string) => `ff-order:${slug}:${id}`;

export function rememberOrderToken(slug: string, id: string, token: string) {
  try {
    localStorage.setItem(tokenKey(slug, id), token);
  } catch {
    /* без хранилища ссылка остаётся в адресе страницы */
  }
}

export function savedOrderToken(slug: string, id: string): string {
  try {
    return localStorage.getItem(tokenKey(slug, id)) ?? "";
  } catch {
    return "";
  }
}
