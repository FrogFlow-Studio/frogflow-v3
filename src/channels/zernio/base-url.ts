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
