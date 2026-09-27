import { isWebSource, webSource, webSourceStorageKey } from "@/core/storefront/web-source";

/**
 * Источник покупателя в браузере (core/storefront/web-source): первая ссылка
 * с utm или ref запоминается и уходит с оформлением заказа. Хранилище может
 * быть недоступно (приватный режим) — тогда источник просто не пишется.
 */
export function rememberWebSource(slug: string, search: string): void {
  try {
    const key = webSourceStorageKey(slug);
    if (localStorage.getItem(key)) return;
    const p = new URLSearchParams(search);
    const src = webSource({
      utm_source: p.get("utm_source") ?? undefined,
      utm_campaign: p.get("utm_campaign") ?? undefined,
      ref: p.get("ref") ?? undefined,
    });
    if (src) localStorage.setItem(key, src);
  } catch {
    /* хранилище закрыто — без источника */
  }
}

export function readWebSource(slug: string): string | undefined {
  try {
    const v = localStorage.getItem(webSourceStorageKey(slug));
    return isWebSource(v) ? v : undefined;
  } catch {
    return undefined;
  }
}
