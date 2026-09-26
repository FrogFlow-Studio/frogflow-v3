import { isLocale, type Locale } from "@/core/i18n/locale";

/**
 * Кнопки прежней платформы (v1), оставшиеся в чатах покупателей после
 * переезда клиента на v2. Покупатель может нажать их и через неделю, поэтому
 * v2 понимает их формат, хотя сама рисует свои (`lang:`, поиск — тот же
 * `searchmore:`).
 */

/** `lang_<язык>:<id заказа>:<индекс позиции>` — выбор языка материалов после оплаты. */
export function parseLegacyLang(
  data: string,
): { lang: Locale; orderId: number; index: number } | null {
  const m = /^lang_([a-z]{2}):(\d+):(\d+)$/.exec(data);
  if (!m || !isLocale(m[1])) return null;
  return { lang: m[1], orderId: Number(m[2]), index: Number(m[3]) };
}

/**
 * Позиция заказа по индексу из кнопки v1: v1 считал индекс среди позиций,
 * отсортированных по id как по строке (bot.server.ts, обработчик `lang_`).
 */
export function legacyLangItem<T extends { id: string }>(
  items: readonly T[],
  index: number,
): T | null {
  const sorted = items.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return sorted[index] ?? null;
}

/** `searchmore:<сдвиг>` — следующая страница поиска; запрос лежит в state.last_search. */
export function parseSearchMore(data: string): number {
  const n = Number(data.slice("searchmore:".length));
  return Number.isInteger(n) && n > 0 ? n : 0;
}

/** Границы страницы результатов и сдвиг следующей (null — больше нет). */
export function searchPage(
  total: number,
  offset: number,
  size: number,
): { from: number; to: number; next: number | null } {
  const from = Math.min(Math.max(0, offset), total);
  const to = Math.min(from + size, total);
  return { from, to, next: to < total ? to : null };
}
