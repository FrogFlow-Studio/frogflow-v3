import type { SectionDict } from "../section";

/** Строки админки продавца четвёртой партии (трек «Витрина»): копия товара и дальше. */
export const ru = {
  "product.copy": "Копировать",
  "product.copySuffix": "— копия",
  "err.catalog.copyNotFound": "Товар не найден.",
} as const;

export const kk: SectionDict<typeof ru> = {
  "product.copy": "Көшіру",
  "product.copySuffix": "— көшірме",
  "err.catalog.copyNotFound": "Тауар табылмады.",
};

export const en: SectionDict<typeof ru> = {
  "product.copy": "Duplicate",
  "product.copySuffix": "— copy",
  "err.catalog.copyNotFound": "Product not found.",
};

export const uz: SectionDict<typeof ru> = {
  "product.copy": "Nusxa olish",
  "product.copySuffix": "— nusxa",
  "err.catalog.copyNotFound": "Mahsulot topilmadi.",
};
