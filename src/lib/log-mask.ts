/**
 * Журнал без личных данных покупателя (перенос logger.server v1): почта и
 * телефон в логах и в учёте ошибок — только в замаскированном виде, длинный
 * текст — с обрезкой. Годится для диагностики, не для восстановления адреса.
 */
export function truncate(value: string | null | undefined, max = 80): string {
  if (!value) return "";
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

/** Первая буква и домен: «i***@example.com». Без @ — целиком «***». */
export function maskEmail(value: string | null | undefined): string {
  if (!value) return "";
  const at = value.indexOf("@");
  if (at <= 0) return "***";
  return `${value.slice(0, 1)}***@${value.slice(at + 1)}`;
}

/** Последние 4 цифры: «***5678». Короче 4 цифр — целиком «***». */
export function maskPhone(value: string | null | undefined): string {
  if (!value) return "";
  const digits = value.replace(/\D/g, "");
  if (digits.length < 4) return "***";
  return `***${digits.slice(-4)}`;
}

/** Все адреса почты внутри свободного текста (ответ SMTP-сервера и т. п.). */
export function maskEmailsIn(text: string): string {
  return text.replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, (m) => maskEmail(m));
}

/** Ключи, значения которых в журнал не идут никогда: ключи доступа, пароли, подписи. */
const SECRET_KEY =
  /^(token|secret|api_?key|password|passwd|authorization|access_?token|bot_?token|refresh_?token|client_?secret|webhook_?secret)$/i;

/**
 * Ссылка на заказ — ключ к нему: подпись `?t=<hex>` вычёркивается из любой строки.
 * Заодно токен Telegram-бота («123456789:AA…») и заголовок `Bearer …`.
 */
export function scrubSecretsIn(text: string): string {
  return text
    .replace(/([?&]t=)[0-9a-f]{16,64}/gi, "$1***")
    .replace(/(?<!\d)\d{6,12}:[A-Za-z0-9_-]{30,}/g, "***:***")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer ***");
}

/**
 * Значение для журнала событий (`zernio_logs`, `bot_events`): ключи `token`, `secret`,
 * `api_key`, `password` на любой глубине — «***», а в строках вычёркнуты подписи ссылок
 * заказа и токены. `keys: false` — только строки: для чужого тела вебхука, где поля
 * называет не мы.
 */
export function scrubForLog<T>(value: T, opts: { keys?: boolean } = {}): T {
  const keys = opts.keys !== false;
  const walk = (v: unknown, depth: number): unknown => {
    if (typeof v === "string") return scrubSecretsIn(v);
    if (v === null || typeof v !== "object" || depth > 12) return v;
    if (Array.isArray(v)) return v.map((x) => walk(x, depth + 1));
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v))
      out[k] = keys && SECRET_KEY.test(k) ? "***" : walk(x, depth + 1);
    return out;
  };
  return walk(value, 0) as T;
}
