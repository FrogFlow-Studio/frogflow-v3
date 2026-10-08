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

/**
 * Форма фото в карточках каталога (Т1): квадрат с обрезкой (как раньше),
 * вертикальная 4:5 без обрезки, фото целиком в квадрате с фоном.
 */
export const PHOTO_SHAPES = ["square", "portrait", "contain"] as const;
export type PhotoShape = (typeof PHOTO_SHAPES)[number];

export type StoreDesign = {
  theme: StoreTheme;
  /** Обложка: крупная картинка магазина над каталогом. */
  cover: boolean;
  /** Показанные блоки в порядке показа; пусто — главная как раньше. */
  blocks: StoreBlock[];
  /** Форма фото товара в карточках; по умолчанию квадрат, как было. */
  photo: PhotoShape;
};

export const DEFAULT_DESIGN: StoreDesign = {
  theme: "fresh",
  cover: false,
  blocks: [],
  photo: "square",
};

const isTheme = (v: unknown): v is StoreTheme => STORE_THEMES.includes(v as StoreTheme);
const isPhoto = (v: unknown): v is PhotoShape => PHOTO_SHAPES.includes(v as PhotoShape);
const isBlock = (v: unknown): v is StoreBlock => STORE_BLOCKS.includes(v as StoreBlock);

/** Разбор сохранённого: неизвестные значения отбрасываются, блоки без повторов. */
export function parseDesign(raw: unknown): StoreDesign {
  const r =
    raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const blocks = Array.isArray(r.blocks)
    ? [...new Set(r.blocks.filter(isBlock))].slice(0, STORE_BLOCKS.length)
    : [];
  return {
    theme: isTheme(r.theme) ? r.theme : "fresh",
    cover: r.cover === true,
    blocks,
    photo: isPhoto(r.photo) ? r.photo : "square",
  };
}

/** Тема как класс на корне витрины; тема по умолчанию класса не добавляет. */
export const themeClass = (theme: StoreTheme): string =>
  theme === "fresh" ? "" : `shop-theme-${theme}`;

/** Сколько товаров в блоке «Новинки», «Хиты», «Наборы» и записей в «Отзывах». */
export const BLOCK_SIZE = 4;

/**
 * Классы рамки фото товара по форме: `box` — для заглушки без фото (та же
 * форма, сетка ровная), `img` — для самой картинки, `thumb` — для миниатюр
 * карточки товара. «4:5» и «целиком» не обрезают: фото вписывается с фоном,
 * квадратные фото в «4:5» не растягиваются.
 */
export function photoFrame(shape: PhotoShape): { box: string; img: string; thumb: string } {
  switch (shape) {
    case "portrait":
      return {
        box: "aspect-[4/5]",
        img: "aspect-[4/5] w-full bg-surface-2 object-contain",
        thumb: "h-20 w-16 bg-surface-2 object-contain",
      };
    case "contain":
      return {
        box: "aspect-square",
        img: "aspect-square w-full bg-surface-2 object-contain",
        thumb: "h-16 w-16 bg-surface-2 object-contain",
      };
    default:
      return {
        box: "aspect-square",
        img: "aspect-square w-full object-cover",
        thumb: "h-16 w-16 object-cover",
      };
  }
}
