import { createHmac, timingSafeEqual } from "node:crypto";

/** Подписанная ссылка на страницу заказа. */

/**
 * Подпись ссылки на страницу заказа. Номер заказа сквозной и угадывается,
 * поэтому без подписи чужой заказ не открыть; секрет — платформенный.
 */
export function orderAccessToken(secret: string, botId: string, orderId: number): string {
  return createHmac("sha256", secret)
    .update(`ff-web-order\0${botId}\0${orderId}`)
    .digest("hex")
    .slice(0, 32);
}

export function verifyOrderAccess(
  secret: string,
  botId: string,
  orderId: number,
  token: string,
): boolean {
  if (!/^[0-9a-f]{32}$/.test(token)) return false;
  return timingSafeEqual(Buffer.from(orderAccessToken(secret, botId, orderId)), Buffer.from(token));
}
