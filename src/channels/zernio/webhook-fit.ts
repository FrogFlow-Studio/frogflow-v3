/**
 * Нужно ли трогать запись вебхука Zernio — чистая проверка без ключа.
 * Вебхук у Zernio один на команду (ключ API): один эндпоинт получает события
 * и Instagram, и WhatsApp всех клиентов платформы. `stale` — запись есть, но
 * указывает не сюда, выключена или не слушает входящие: снаружи это «бот в
 * инсте не отвечает», пока автоматизации Zernio продолжают работать.
 */
export const ZERNIO_WEBHOOK_NAME = "FrogFlow Store Webhook";
const LEGACY_NAMES = ["Store Webhook", "Instagram Store Webhook"];

export const ZERNIO_WEBHOOK_EVENTS = [
  "message.received",
  "comment.received",
  "account.disconnected",
  "whatsapp.template.status_updated",
] as const;

export type ZernioWebhookRecord = {
  _id?: string;
  id?: string;
  url?: string;
  name?: string;
  events?: string[];
  isActive?: boolean;
  active?: boolean;
};

export type ZernioWebhookFit = "missing" | "stale" | "ok";

export function findStoreWebhook(
  webhooks: ZernioWebhookRecord[],
  expectedUrl: string,
): ZernioWebhookRecord | undefined {
  return webhooks.find(
    (w) =>
      w.url === expectedUrl ||
      w.name === ZERNIO_WEBHOOK_NAME ||
      LEGACY_NAMES.includes(w.name ?? ""),
  );
}

export function describeWebhookFit(
  webhooks: ZernioWebhookRecord[],
  expectedUrl: string,
): { fit: ZernioWebhookFit; current?: ZernioWebhookRecord } {
  const current = findStoreWebhook(webhooks, expectedUrl);
  if (!current) return { fit: "missing" };
  const active = current.isActive !== false && current.active !== false;
  // Без comment.received двухшаговая DM по комментарию не срабатывает — запись «устарела».
  const events = current.events ?? [];
  const listens = events.includes("message.received") && events.includes("comment.received");
  if (!active || current.url !== expectedUrl || !listens) return { fit: "stale", current };
  return { fit: "ok", current };
}

/**
 * Чужой деплой (v1 клиента с тем же ключом) держит store-webhook: крон не
 * должен отбирать запись молча — v1 и v2 работают одновременно, и клиент
 * переезжает по одному. Ручная установка из панели оператора — переписывает.
 */
export function isOtherStoreWebhook(currentUrl: string | undefined, expectedUrl: string): boolean {
  if (!currentUrl) return false;
  try {
    const current = new URL(currentUrl);
    const expected = new URL(expectedUrl);
    if (!/\/api\/(public\/)?zernio\/webhook\/?$/.test(current.pathname)) return false;
    return current.origin !== expected.origin;
  } catch {
    return false;
  }
}
