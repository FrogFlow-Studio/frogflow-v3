import type { IssueRequest, SubscriptionPayProvider } from "./provider";

/**
 * Перевод по реквизитам: текст счёта в бота владельца, владелец платит сам и
 * присылает чек следующим сообщением. Статус узнаётся не отсюда, а по чеку.
 */
export function transferText(
  req: Pick<IssueRequest, "amount" | "currency" | "note" | "requisites">,
) {
  return (
    `Счёт на оплату подписки\n\nСумма: ${req.amount} ${req.currency}${req.note ? `\nЗа что: ${req.note}` : ""}` +
    `\n\nРеквизиты для оплаты:\n${req.requisites}\n\nПосле оплаты пришлите, пожалуйста, фото или файл с чеком следующим сообщением в этот чат.`
  );
}

export const transferProvider: SubscriptionPayProvider = {
  key: "transfer",
  async unavailable(req) {
    return req.requisites.trim()
      ? null
      : "Реквизиты для выплат не заданы — заполните их в настройках платформы.";
  },
  async issue(req) {
    return { provider: "transfer", externalId: null, ownerText: transferText(req) };
  },
};
