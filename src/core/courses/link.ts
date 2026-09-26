import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Ссылка на курс для покупателя: `/s/<магазин>/course/<позиция заказа>?k=<подпись>`.
 * Работает в любом канале (Telegram, Instagram, WhatsApp, почта) без входа:
 * подпись — HMAC платформенного секрета по клиенту и позиции заказа, так что
 * чужую позицию подобрать нельзя, а ссылка одного магазина не открывает
 * курс другого. Секрет передаёт вызывающий (ядро не читает окружение).
 */
const LEN = 22;

export function courseToken(secret: string, tenantId: string, orderItemId: string): string {
  return createHmac("sha256", secret)
    .update(`course:${tenantId}:${orderItemId}`)
    .digest("base64url")
    .slice(0, LEN);
}

export function isCourseToken(
  secret: string,
  tenantId: string,
  orderItemId: string,
  token: string,
): boolean {
  if (typeof token !== "string" || token.length !== LEN) return false;
  const want = Buffer.from(courseToken(secret, tenantId, orderItemId));
  const got = Buffer.from(token);
  return got.length === want.length && timingSafeEqual(got, want);
}

export function coursePath(slug: string, orderItemId: string, token: string): string {
  return `/s/${encodeURIComponent(slug)}/course/${orderItemId}?k=${token}`;
}
