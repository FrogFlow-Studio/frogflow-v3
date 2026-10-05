/**
 * Избранное покупателя на площадке (К1): чистые правила. Человек — подтверждённое
 * удостоверение (`marketplace_buyers`), товар — строка снимка площадки (`marketplace_items`).
 */
/** Сколько товаров можно держать в избранном: больше — просим убрать лишнее, а не молча теряем. */
export const FAVORITES_MAX = 200;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: unknown): s is string => typeof s === "string" && UUID.test(s);

/** Ключ товара в списке «сердечек»: магазин и товар. */
export const favoriteKey = (botId: string, productId: string) => `${botId}:${productId}`;

export type FavoriteItem = {
  shopId: string;
  shopSlug: string;
  shopName: string;
  id: string;
  name: string;
  price: number;
  currency: string;
  image: string | null;
};
