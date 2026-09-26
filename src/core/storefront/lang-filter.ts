import { MATERIAL_LANGUAGES } from "@/core/catalog/materials";
import type { Locale } from "@/core/i18n/locale";

/**
 * Фильтр каталога по языку материала, как чипы RU/KZ в Mini App v1
 * (tests/mini-app-catalog.test.ts). Только при модуле multi_language.
 * Чипы строятся по НЕфильтрованному каталогу: выбранный язык не прячет
 * остальные чипы, покупатель переключается между ними без «Все».
 * Одного языка на весь каталог мало для выбора — тогда чипов нет.
 */
export function languageChips(products: ReadonlyArray<{ languages: readonly string[] }>): Locale[] {
  const seen = new Set(products.flatMap((p) => p.languages));
  const chips = MATERIAL_LANGUAGES.filter((l) => seen.has(l));
  return chips.length > 1 ? chips : [];
}

/** Товары с файлами на этом языке; физические (без файлов) при выбранном языке не показываем. */
export function filterByLanguage<T extends { languages: readonly string[] }>(
  products: readonly T[],
  lang: string | null | undefined,
): T[] {
  if (!lang) return [...products];
  return products.filter((p) => p.languages.includes(lang));
}
