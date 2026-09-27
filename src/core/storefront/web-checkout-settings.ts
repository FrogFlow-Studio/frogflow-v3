/** Настройка «оформление на сайте» в app_settings; без node-зависимостей — её читает и страница настроек. */
export const WEB_CHECKOUT_KEY = "storefront_checkout";

export type WebCheckoutSettings = {
  enabled: boolean;
  /**
   * Кнопка «Войти через Telegram» на витрине. Продавец включает её сам: виджет
   * Telegram работает, только когда у бота в @BotFather указан адрес витрины
   * (/setdomain), а проверить это отсюда нельзя.
   */
  tgLogin: boolean;
};

export function parseWebCheckout(raw: string | null | undefined): WebCheckoutSettings {
  try {
    const p = JSON.parse(raw || "{}") as { enabled?: unknown; tgLogin?: unknown };
    return { enabled: p.enabled === true, tgLogin: p.tgLogin === true };
  } catch {
    return { enabled: false, tgLogin: false };
  }
}
