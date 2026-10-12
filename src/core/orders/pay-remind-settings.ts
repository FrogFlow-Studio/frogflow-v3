/** Настройка напоминания об оплате (core/orders/pay-remind) — без серверных зависимостей, для админки. */
export const PAY_REMIND_KEY = "chat_pay_reminder_hours";
/** Ключ метки «напомнили» у заказов из чата: общий у крона и кнопки «Напомнить». */
export const PAY_REMIND_EVENT_KEY = "chat";
export const PAY_REMIND_HOURS = [1, 2, 3, 6, 12] as const;

/** Часы из настройки; пусто, «0» и всё, чего нет в списке, — выключено. */
export function parsePayRemindHours(raw: string | null | undefined): number | null {
  const n = Number(raw);
  return (PAY_REMIND_HOURS as readonly number[]).includes(n) ? n : null;
}

/**
 * «Не напоминать по спорным заказам» (#40 Копилки): напоминание придерживается,
 * если у покупателя открыто обращение или после этого заказа он оформил другой.
 * Включено по умолчанию; "false" — продавец выключил.
 */
export const PAY_REMIND_HOLD_KEY = "chat_pay_reminder_hold";

export function payRemindHoldOn(raw: string | null | undefined): boolean {
  return raw !== "false";
}
