/**
 * Сообщение переписки из API Zernio. В событии вебхука текст — `text`, время
 * — `sentAt`; список переписки в v1 читался как `message`/`createdAt` и все
 * сообщения выходили пустыми (fix 2e8feb4). Читаем оба написания и сразу
 * приводим к одному виду — ниже никто о двух формах не знает.
 */
export type ZernioInboxMessage = {
  id?: string;
  /** Тот же id в стиле Mongo — так Zernio отдаёт аккаунты и профили (api.server). */
  _id?: string;
  message?: string;
  text?: string;
  direction?: "incoming" | "outgoing" | string;
  createdAt?: string;
  sentAt?: string;
  /** Чем отправлено: через Zernio или из приложения Instagram. */
  sentVia?: string | null;
  /** Отправлено сценарием Zernio (автоответ на комментарий, цепочка, рассылка) — не человеком. */
  automationId?: string | null;
  workflowId?: string | null;
  sequenceId?: string | null;
  broadcastId?: string | null;
  executionId?: string | null;
  /**
   * Поля сообщения в той же форме, что в событии вебхука (message.received):
   * опрос ящика (inbox-poll.server) отдаёт их обработчику как есть — фото,
   * голосовое и ответ на сторис разбирает тот же parseZernioMessage.
   */
  platformMessageId?: string;
  attachments?: NonNullable<
    NonNullable<import("./message").ZernioWebhookMessagePayload["message"]>["attachments"]
  >;
  sender?: NonNullable<import("./message").ZernioWebhookMessagePayload["message"]>["sender"];
  metadata?: import("./message").ZernioInteractiveMetadata;
};

export function normalizeInboxMessage(m: ZernioInboxMessage): ZernioInboxMessage {
  const message = m.message ?? m.text;
  const createdAt = m.createdAt ?? m.sentAt;
  const id = m.id ?? m._id;
  return {
    ...m,
    ...(id ? { id } : {}),
    ...(message != null ? { message } : {}),
    ...(createdAt ? { createdAt } : {}),
  };
}
