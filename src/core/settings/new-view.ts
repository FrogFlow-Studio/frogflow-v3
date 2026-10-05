/**
 * Переключатель «новый вид» (партия 21): новые страницы админки и площадки
 * (главная «Ждёт вас», заказы в три колонки, товар одной страницей, темы
 * настроек, площадка «Все товары / Авторы») показываются только когда он
 * включён. Хранится в app_settings под ключом `new_view`: "true" — включён,
 * "false" — выключен, нет значения — NEW_VIEW_DEFAULT. Сегодня по умолчанию
 * выключен; «включить всем» — смена одной константы, «вернуть» — выключатель
 * в настройках, выкладка не нужна. Старые страницы остаются рабочими.
 */
export const NEW_VIEW_KEY = "new_view";
export const NEW_VIEW_DEFAULT = false;

export function newViewOn(value: string | null | undefined): boolean {
  if (value === "true") return true;
  if (value === "false") return false;
  return NEW_VIEW_DEFAULT;
}
