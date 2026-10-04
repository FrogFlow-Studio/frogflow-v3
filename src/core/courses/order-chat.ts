/**
 * Настоящий чат бота у ученика: Telegram-покупатель с положительным id. Канал
 * заказа не важен — заказ с сайта от вошедшего через Telegram (`web`) пишет
 * настоящий `telegram_id`, и боту можно ему писать. У покупателя из почты,
 * Instagram и WhatsApp id синтетический (отрицательный): чата в Telegram нет.
 */
export function orderChatId(order: { telegram_id?: number | string | null }): number | null {
  const id = Number(order.telegram_id);
  return Number.isFinite(id) && id > 0 ? id : null;
}
