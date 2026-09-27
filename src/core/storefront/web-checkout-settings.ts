/** Настройка «оформление на сайте» в app_settings; без node-зависимостей — её читает и страница настроек. */
export const WEB_CHECKOUT_KEY = "storefront_checkout";

export type WebCheckoutSettings = { enabled: boolean };

export function parseWebCheckout(raw: string | null | undefined): WebCheckoutSettings {
  try {
    const p = JSON.parse(raw || "{}") as { enabled?: unknown };
    return { enabled: p.enabled === true };
  } catch {
    return { enabled: false };
  }
}
