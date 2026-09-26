export const DEFAULT_ZERNIO_BASE_URL = "https://zernio.com/api/v1";

/**
 * `https://zernio.com` без пути — частая ошибка в переменных окружения: запрос
 * проходит с 200, но в ответе HTML-страница, и разбор JSON падает на «<».
 * Такое значение достраивается до API; остальное берётся как есть без
 * завершающего слэша.
 */
export function normalizeZernioBaseUrl(value?: string | null): string {
  const configured = value?.trim() || DEFAULT_ZERNIO_BASE_URL;
  try {
    const url = new URL(configured);
    if (url.hostname === "zernio.com" && (url.pathname === "" || url.pathname === "/")) {
      url.pathname = "/api/v1";
    }
    return url.toString().replace(/\/$/, "");
  } catch {
    return configured.replace(/\/$/, "");
  }
}

/**
 * Нужен ли ключ Zernio, чтобы скачать вложение по этой ссылке. Вложения
 * WhatsApp Zernio отдаёт через свой API (медиа Meta без токена не отдаётся),
 * и без ключа приходит 401 — чек «не скачался». Ключ уходит только на хост
 * API Zernio и только по https: ссылке на чужой хост ключ не показываем.
 */
export function attachmentNeedsZernioKey(url: string, baseUrl?: string | null): boolean {
  try {
    const u = new URL(url);
    const api = new URL(normalizeZernioBaseUrl(baseUrl));
    return u.protocol === "https:" && u.host === api.host;
  } catch {
    return false;
  }
}
