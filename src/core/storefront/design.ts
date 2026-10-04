/**
 * Оформление витрины (В3): готовая тема, обложка и порядок блоков главной.
 * Хранится в `bots.settings.storefront_design`; свой акцентный цвет магазина
 * (`storefront_accent`) поверх темы по-прежнему работает.
 */
export const STORE_THEMES = ["fresh", "warm", "classic"] as const;
export type StoreTheme = (typeof STORE_THEMES)[number];

/** Блоки над каталогом: новинки, хиты, наборы, отзывы. */
export const STORE_BLOCKS = ["new", "hits", "sets", "reviews"] as const;
export type StoreBlock = (typeof STORE_BLOCKS)[number];

export type StoreDesign = {
  theme: StoreTheme;
  /** Обложка: крупная картинка магазина над каталогом. */
  cover: boolean;
  /** Показанные блоки в порядке показа; пусто — главная как раньше. */
  blocks: StoreBlock[];
};

export const DEFAULT_DESIGN: StoreDesign = { theme: "fresh", cover: false, blocks: [] };

const isTheme = (v: unknown): v is StoreTheme => STORE_THEMES.includes(v as StoreTheme);
const isBlock = (v: unknown): v is StoreBlock => STORE_BLOCKS.includes(v as StoreBlock);

/** Разбор сохранённого: неизвестные значения отбрасываются, блоки без повторов. */
export function parseDesign(raw: unknown): StoreDesign {
  const r =
    raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const blocks = Array.isArray(r.blocks)
    ? [...new Set(r.blocks.filter(isBlock))].slice(0, STORE_BLOCKS.length)
    : [];
  return { theme: isTheme(r.theme) ? r.theme : "fresh", cover: r.cover === true, blocks };
}

/** Тема как класс на корне витрины; тема по умолчанию класса не добавляет. */
export const themeClass = (theme: StoreTheme): string =>
  theme === "fresh" ? "" : `shop-theme-${theme}`;

/** Сколько товаров в блоке «Новинки», «Хиты», «Наборы» и записей в «Отзывах». */
export const BLOCK_SIZE = 4;
