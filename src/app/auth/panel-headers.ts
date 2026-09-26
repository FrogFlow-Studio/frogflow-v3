/**
 * Заголовки страниц панелей /admin и /operator: запрет встраивания в чужой
 * iframe (кликджекинг — «невидимая» кнопка подтверждения заказа или смены
 * пароля поверх чужой страницы), запрет угадывания типа, без Referer наружу.
 * Витрину /s/* не трогаем: Mini App открывается во фрейме Telegram Web.
 */
export const PANEL_HEADERS: Record<string, string> = {
  "X-Frame-Options": "DENY",
  "Content-Security-Policy": "frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
};

export const panelHeaders = () => PANEL_HEADERS;
