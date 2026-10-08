/**
 * Нужен ли пункт меню «Уведомления». Лента знает только заказы, чеки, отзывы
 * и возвраты (core/notifications/feed); у консультанта без продаж
 * (`sells === false`, BOVI) она всегда пуста — пункт не показываем.
 * Бухгалтеру пункт нужен всегда: он смотрит чеки. Нет `sells` — продаёт.
 */
export function notificationsInNav(shop: { role: string; sells?: boolean }): boolean {
  return shop.role === "accountant" || shop.sells !== false;
}
