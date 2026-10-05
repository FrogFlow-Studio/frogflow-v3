/**
 * Что из отчёта аналитики видит роль (У5). Бухгалтер получает отчёты — выручку,
 * воронку по каналам, покупателей, скорость заказа, — но не источники
 * (откуда пришли покупатели, ссылки с метками) и не советы «Что продвигать»:
 * это про продвижение, а не про учёт. Остальные роли видят всё.
 */
export function accountantView<
  T extends {
    sources: unknown[];
    links: { bot: string | null; store: string | null };
    promote: unknown;
  },
>(a: T, accountant: boolean): T {
  if (!accountant) return a;
  return { ...a, sources: [], links: { bot: null, store: null }, promote: null };
}
