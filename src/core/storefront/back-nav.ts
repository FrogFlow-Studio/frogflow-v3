/**
 * Кнопка «Назад» Telegram в Mini App витрины (Т2) и возврат к результатам поиска.
 * Чистая логика: что показывать и что делать по нажатию; подключение к
 * `Telegram.WebApp.BackButton` — в `app/storefront/telegram-back.tsx`.
 */

/** Главная каталога магазина: `/s/<slug>` (с косой чертой в конце или без). */
export function isCatalogHome(pathname: string, slug: string): boolean {
  return pathname.replace(/\/+$/, "") === `/s/${slug}`;
}

export type BackAction = "close-overlay" | "history" | "catalog";

/**
 * Что делает «Назад»: открыт просмотр фото — закрывает его, а не страницу;
 * на главной каталога кнопки нет (там Telegram показывает «Закрыть»); есть
 * история внутри Mini App — шаг назад; товар открыт по прямой ссылке
 * (истории нет) — переход в каталог магазина, а не закрытие.
 */
export function telegramBack(input: {
  pathname: string;
  slug: string;
  overlayOpen: boolean;
  canGoBack: boolean;
}): { visible: boolean; action: BackAction | null } {
  if (input.overlayOpen) return { visible: true, action: "close-overlay" };
  if (isCatalogHome(input.pathname, input.slug)) return { visible: false, action: null };
  return { visible: true, action: input.canGoBack ? "history" : "catalog" };
}

/** Откуда открыт товар: поиск `q` (и категория, если искали в ней). */
export type SearchReturn = { q: string; cat?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Разбор `?q=&cat=` карточки товара: пустой или слишком длинный запрос — не из поиска. */
export function parseSearchReturn(raw: Record<string, unknown>): SearchReturn | null {
  const q = typeof raw.q === "string" ? raw.q.trim() : "";
  if (!q || q.length > 200) return null;
  const cat = typeof raw.cat === "string" && UUID.test(raw.cat) ? raw.cat : undefined;
  return cat ? { q, cat } : { q };
}

/** Запрос для подписи «← Результаты: „…“» — длинный обрезается многоточием. */
export function shortQuery(q: string, max = 40): string {
  const s = q.trim();
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}
