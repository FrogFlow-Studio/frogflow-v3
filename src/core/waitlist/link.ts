/**
 * Ссылка «Сообщить о поступлении» с сайта: t.me/<бот>?start=w_<id товара>.
 * Бот по ней записывает покупателя в тот же лист ожидания, что и кнопка в
 * чате. Почта сайта ничего не подписывает (она не подтверждена): подписка —
 * только от аккаунта Telegram, нажавшего «Старт».
 */
export const WAITLIST_PREFIX = "w_";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** id товара из параметра /start; не ссылка листа ожидания или мусор — null. */
export function parseWaitlistPayload(payload: string): string | null {
  if (!payload.startsWith(WAITLIST_PREFIX)) return null;
  const id = payload.slice(WAITLIST_PREFIX.length);
  return UUID.test(id) ? id : null;
}

/**
 * Ссылка для карточки товара на сайте: только при модуле waitlist, нулевом
 * остатке (товар нельзя купить) и известном боте магазина.
 */
export function waitlistLink(
  botUsername: string | null | undefined,
  product: { id: string; inStock: boolean },
  moduleOn: boolean,
): string | null {
  const bot = botUsername?.replace(/^@/, "") ?? "";
  if (!moduleOn || product.inStock || !bot) return null;
  return `https://t.me/${bot}?start=${WAITLIST_PREFIX}${product.id}`;
}

/**
 * Ссылка ведёт в лист ожидания, только пока товар недоступен — по тому же
 * правилу, что кнопка в чате (channels/telegram/screens: модуль «Склад» и
 * нулевой остаток); иначе бот покажет обычную карточку.
 */
export function shouldJoinWaitlist(
  stockModule: boolean | undefined,
  p: { stock_quantity: number | null },
): boolean {
  return Boolean(stockModule) && p.stock_quantity != null && p.stock_quantity <= 0;
}
