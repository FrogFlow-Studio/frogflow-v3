/** Диалоги продавца, партия 16 (seed/shop16-d-chat.ts, shop16-d-chat.spec.ts). */
/** Магазин с многими диалогами: сверх первой страницы списка (50) ещё 60 покупателей «Клиент N». */
export const CHAT_MANY_COUNT = 60;
export const chatManyName = (n: number) => `Клиент ${n}`;
export const chatManyId = (n: number) => 920000 + n;
