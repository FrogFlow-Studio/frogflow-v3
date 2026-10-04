/** Диалоги продавца, партия 16 (seed/shop16-d-chat.ts, shop16-d-chat.spec.ts). */
/** Магазин с многими диалогами: сверх первой страницы списка (50) ещё 60 покупателей «Клиент N». */
export const CHAT_MANY_COUNT = 60;
export const chatManyName = (n: number) => `Клиент ${n}`;
export const chatManyId = (n: number) => 920000 + n;

/** Панель покупателя в диалоге: баллы и два заказа (оплаченный и отменённый). */
export const CHAT_PANEL_ID = 930001;
export const CHAT_PANEL_NAME = "Покупатель с историей";
export const CHAT_PANEL_POINTS = 340;
export const CHAT_PANEL_ORDER_NO = 8801;
export const CHAT_PANEL_CANCELLED_NO = 8802;
export const CHAT_PANEL_TOTAL = 12500;
