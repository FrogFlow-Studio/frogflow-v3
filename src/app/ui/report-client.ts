import { clientErrorReport, isBrowserFailure } from "@/lib/shown-error";

const sent = new WeakSet<object>();

/**
 * Сообщить серверу о сбое, который человек увидел как «не удалось связаться
 * с сервером»: подробности уходят в Sentry через /api/client-error. Один
 * объект ошибки — один отчёт; отказы, конец сессии и отмена не отправляются.
 */
export function reportBrowserFailure(e: unknown): void {
  if (typeof window === "undefined" || !isBrowserFailure(e)) return;
  if (e && typeof e === "object") {
    if (sent.has(e)) return;
    sent.add(e);
  }
  try {
    void fetch("/api/client-error", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(clientErrorReport(e, window.location.pathname)),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Отчёт не должен ломать страницу.
  }
}
