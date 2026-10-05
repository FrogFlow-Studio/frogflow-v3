/**
 * Навигация по темам настроек в новом виде: тема слева, открыта одна, по
 * умолчанию «Магазин»; «Все» остаётся пунктом. Чистые функции — страница
 * только вызывает их, а тест проверяет без браузера.
 */
import { settingsEntry, type SettingsTheme } from "./registry";

export type ThemeChoice = SettingsTheme | "all";

/** Тема, с которой открывается страница в новом виде. */
export const DEFAULT_THEME: ThemeChoice = "shop";

/**
 * Якорь `#id` из адреса → тема, которую надо открыть, чтобы раздел был виден.
 * Неизвестный якорь или раздел «ссылкой» (без карточки) темы не меняет.
 */
export function themeForHash(hash: string): SettingsTheme | null {
  const id = decodeURIComponent(hash.replace(/^#/, ""));
  const entry = id ? settingsEntry(id) : undefined;
  return entry && !entry.to ? entry.theme : null;
}

/** Раздел показан: тема совпадает или «Все»; при поиске тема не мешает найти. */
export function themeShows(choice: ThemeChoice, theme: SettingsTheme, searching: boolean): boolean {
  return searching || choice === "all" || choice === theme;
}
