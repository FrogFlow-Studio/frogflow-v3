/**
 * Спрашивать ли почту после чека в Instagram (Кристина, 10.10: «может с почтой
 * не стоит заморачиваться? удобно, когда материал сразу в инстаграм»).
 * Материалы и так приходят в переписку; выключено — бот почту не спрашивает,
 * а если покупатель сам попросит «на почту», адрес спросит ИИ после оплаты
 * (core/postpay).
 */
export const CHAT_EMAIL_ASK_KEY = "chat_email_ask";

/** Клиенты, у которых без настройки почту не спрашиваем: Копилка русоведа. */
export const EMAIL_ASK_DEFAULT_OFF: readonly string[] = ["4f9562e2-3bf4-4cba-8a58-794637511431"];

/** "true"/"false" — выбор продавца; без значения — по умолчанию клиента. */
export function emailAskOn(raw: string | null | undefined, botId: string): boolean {
  if (raw === "true") return true;
  if (raw === "false") return false;
  return !EMAIL_ASK_DEFAULT_OFF.includes(botId);
}
