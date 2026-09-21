/**
 * Сообщение переписки из API Zernio. В событии вебхука текст — `text`, время
 * — `sentAt`; список переписки в v1 читался как `message`/`createdAt` и все
 * сообщения выходили пустыми (fix 2e8feb4). Читаем оба написания и сразу
 * приводим к одному виду — ниже никто о двух формах не знает.
 */
export type ZernioInboxMessage = {
  id?: string;
  message?: string;
  text?: string;
  direction?: "incoming" | "outgoing" | string;
  createdAt?: string;
  sentAt?: string;
  /** Чем отправлено: через Zernio или из приложения Instagram. */
  sentVia?: string;
};

export function normalizeInboxMessage(m: ZernioInboxMessage): ZernioInboxMessage {
  const message = m.message ?? m.text;
  const createdAt = m.createdAt ?? m.sentAt;
  return { ...m, ...(message != null ? { message } : {}), ...(createdAt ? { createdAt } : {}) };
}
