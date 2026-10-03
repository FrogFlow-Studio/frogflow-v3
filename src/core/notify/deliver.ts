/**
 * Одно сообщение нескольким продавцам: каждому отдельно, отказ одного не
 * срывает остальных и виден поимённо. В v1 «отправлено» показывалось, даже
 * когда не дошло никому, а пустой список получателей выглядел как успех.
 */
export type DeliveryReport = {
  delivered: string[];
  failed: Array<{ id: string; reason: string }>;
  /** Дошло хотя бы одному. */
  ok: boolean;
  /** Некому слать: ни владельца в карточке, ни admin_chat_id. */
  noRecipients: boolean;
};

export const NO_RECIPIENTS_REASON =
  "получателей нет: у магазина не указан Telegram-id владельца и нет admin_chat_id";

export async function deliverToEach(
  ids: readonly string[],
  send: (id: string) => Promise<{ ok?: boolean; description?: string }>,
): Promise<DeliveryReport> {
  const delivered: string[] = [];
  const failed: DeliveryReport["failed"] = [];
  for (const id of ids) {
    try {
      const r = await send(id);
      if (r.ok) delivered.push(id);
      else failed.push({ id, reason: humanTelegramReason(r.description) });
    } catch (e) {
      failed.push({ id, reason: humanTelegramReason(e instanceof Error ? e.message : String(e)) });
    }
  }
  return {
    delivered,
    failed,
    ok: delivered.length > 0,
    noRecipients: ids.length === 0,
  };
}

const REASONS: Array<[RegExp, string]> = [
  [/bot was blocked by the user/i, "заблокировал бота"],
  [/user is deactivated/i, "аккаунт Telegram удалён"],
  [/chat not found/i, "не писал боту /start или id указан с ошибкой"],
  [/bot can't initiate conversation/i, "не писал боту /start"],
  [/bots can't send messages to bots/i, "это id другого бота, а не человека"],
  [/have no rights to send|not enough rights/i, "у бота нет права писать в этот чат"],
  [/unauthorized/i, "токен бота недействителен"],
  [/too many requests|retry after/i, "Telegram просит подождать, попробуйте позже"],
  [/retries exhausted|fetch failed|network|timeout/i, "Telegram не ответил, попробуйте позже"],
];

/**
 * Отказ без ответа (обрыв, тайм-аут, исчерпанные повторы): сообщение могло
 * дойти. Повторять такую отправку нельзя — покупатель получит его дважды.
 */
export function mayHaveArrived(reason: string): boolean {
  return /retries exhausted|fetch failed|network|timeout|не ответил/i.test(reason);
}

/** Отказ Telegram — понятными словами, исходный текст в скобках для поддержки. */
export function humanTelegramReason(description: string | null | undefined): string {
  const raw = (description ?? "").trim();
  if (!raw) return "Telegram не ответил, попробуйте позже";
  const hit = REASONS.find(([re]) => re.test(raw));
  return hit ? `${hit[1]} (${raw})` : raw;
}
