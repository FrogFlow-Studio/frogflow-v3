/**
 * Пункты меню «Помощь». Отдельно от статей: маршрут проверяет пункт до загрузки
 * страницы, и импорт всего текста статей утянул бы его в общий код каждой страницы
 * сайта, включая главную.
 */
export const HELP_GROUPS = ["start", "guide", "trouble"] as const;
export type HelpGroup = (typeof HELP_GROUPS)[number];
