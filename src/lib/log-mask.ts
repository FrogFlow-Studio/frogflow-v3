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
