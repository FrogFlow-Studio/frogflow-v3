import { withoutCourseMarker } from "@/core/courses/marker";
import {
  MATERIAL_LANGUAGES,
  materialsForProduct,
  type ProductWithFiles,
} from "@/core/catalog/materials";
import type { Locale } from "@/core/i18n/locale";

/**
 * Список файлов материала на странице товара, как в Mini App v1: название и
 * язык каждого файла, без ключей хранилища и ссылок (файлы покупатель
 * получает только после оплаты). Без модуля multi_language выдаётся только
 * русский (itemAvailableLanguages) — показываем только его.
 */
export type ProductFile = { name: string; lang: Locale };

export function productFiles(
  product: ProductWithFiles | null | undefined,
  multiLanguage: boolean,
): ProductFile[] {
  if (!product || product.fulfillment_kind === "physical") return [];
  const langs: readonly Locale[] = multiLanguage ? MATERIAL_LANGUAGES : ["ru"];
  const out: ProductFile[] = [];
  for (const lang of langs) {
    // Метка товара-курса — не файл (core/courses/marker).
    const list = withoutCourseMarker(materialsForProduct(product, lang));
    list.forEach((m, i) => {
      const name = m.name?.trim() || (list.length > 1 ? `${i + 1}` : "");
      out.push({ name, lang });
    });
  }
  return out;
}
