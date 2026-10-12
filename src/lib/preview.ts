import { env } from "@/config/env";

/**
 * Режим предпросмотра (PREVIEW_READONLY=1): сборку можно открыть на общей
 * базе, не трогая клиентов. Кроны и вебхуки отвечают 200 без работы, отправка
 * в Telegram, Zernio, почту и push выключена, вызовы ИИ (Anthropic), Google
 * Чтение чеков ИИ и выставление счетов ApiPay тоже: они стоят денег. Запись в базу из
 * панелей остаётся — продавец и оператор в предпросмотре работают как обычно.
 * Каждый внешний клиент сам спрашивает `previewReadonly()`; список клиентов
 * держит тест preview-clients.test.ts.
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

/** Ошибка вызова ИИ в предпросмотре: каждый вызов модели — деньги платформы. */
export const PREVIEW_AI_OFF = "Предпросмотр (PREVIEW_READONLY): вызовы ИИ выключены";

/** Причина отказа отправки в предпросмотре — видна в журнале и в ответе вызывающему. */
export const PREVIEW_SEND_OFF = "Предпросмотр (PREVIEW_READONLY): отправка выключена";
