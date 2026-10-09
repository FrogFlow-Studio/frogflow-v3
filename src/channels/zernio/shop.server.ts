import { env } from "@/config/env";
import { fingerprint } from "./shop/context.server";

/**
 * Магазин в Instagram Direct и WhatsApp (модули dm_shop / wa_shop). Вход; сценарий
 * разложен по shop/: context (состояние и ответ), route (разбор сообщения и кнопок),
 * catalog, cart, checkout (оформление и оплата), receipt (чек, выдача, заказы, баллы).
 */
export { type ShopOutcome } from "./shop/context.server";
export { expressFromAutomation, handleShopMessage } from "./shop/route.server";
export { cartCard } from "./shop/cart.server";

export const __test = { fingerprint, env };
