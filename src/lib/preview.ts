import { env } from "@/config/env";

/**
 * Режим предпросмотра (PREVIEW_READONLY=1): сборку можно открыть на общей
 * базе, не трогая клиентов. Кроны и вебхуки отвечают 200 без работы, а
 * отправка в Telegram, Zernio и почту выключена. Прочее окружение не меняется.
 */
export function previewReadonly(): boolean {
  try {
    return env().PREVIEW_READONLY === "1";
  } catch {
    // Окружение не собралось — приложение не работает целиком; клиенты Telegram/почты
    // (api.ts, mail) не должны падать на этом раньше времени: их тесты окружения не задают.
    return false;
  }
}

/** Ответ вебхука или крона в предпросмотре: 200 и никакой работы; иначе null. */
export function previewWebhookResponse(): Response | null {
  return previewReadonly()
    ? Response.json({ ok: true, preview: true, skipped: "PREVIEW_READONLY" })
    : null;
}

/** Причина отказа отправки в предпросмотре — видна в журнале и в ответе вызывающему. */
export const PREVIEW_SEND_OFF = "Предпросмотр (PREVIEW_READONLY): отправка выключена";
