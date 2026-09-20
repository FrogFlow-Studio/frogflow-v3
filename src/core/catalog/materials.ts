import type { Locale } from "@/core/i18n/locale";

/**
 * Файлы материала — в одном виде для всех, кто их снимает в заказ.
 *
 * Унаследовано из v1 после заказа №484: проверка «есть ли файлы» и снимок
 * файлов в заказ считали по-разному, товар проходил на продажу, а заказ
 * получался пустым. Здесь логика одна и чистая.
 *
 * Порядок: сначала product_material_files (несколько, с сортировкой), потом
 * старые одиночные поля — только для ru и kk, у en/uz такой пары не было.
 */
export type MaterialSnapshot = { path: string | null; name: string | null; url: string | null };

export type ProductWithFiles = {
  fulfillment_kind?: string | null;
  file_path?: string | null;
  file_name?: string | null;
  file_url?: string | null;
  file_path_kz?: string | null;
  file_name_kz?: string | null;
  file_url_kz?: string | null;
  product_material_files?: Array<{
    language?: string | null;
    file_path?: string | null;
    file_name?: string | null;
    sort_order?: number | null;
  }> | null;
};

export const MATERIAL_LANGUAGES: readonly Locale[] = ["ru", "kk", "en", "uz"];

/** Колонки, которые обязан выбрать любой select, чей результат идёт сюда. */
export const MATERIAL_COLUMNS =
  "fulfillment_kind, file_path, file_name, file_path_kz, file_name_kz, file_url, file_url_kz, product_material_files(language, file_path, file_name, sort_order)";

export function materialsForProduct(
  product: ProductWithFiles | null | undefined,
  lang: Locale,
): MaterialSnapshot[] {
  const rows = (product?.product_material_files ?? [])
    .filter((f) => (f.language ?? "ru") === lang && f.file_path)
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    .map((f) => ({ path: f.file_path ?? null, name: f.file_name ?? null, url: null }));
  if (rows.length) return rows;
  if (lang === "ru" && (product?.file_path || product?.file_url)) {
    return [
      {
        path: product.file_path ?? null,
        name: product.file_name ?? null,
        url: product.file_url ?? null,
      },
    ];
  }
  if (lang === "kk" && (product?.file_path_kz || product?.file_url_kz)) {
    return [
      {
        path: product.file_path_kz ?? null,
        name: product.file_name_kz ?? null,
        url: product.file_url_kz ?? null,
      },
    ];
  }
  return [];
}

export function materialLanguages(product: ProductWithFiles | null | undefined): Locale[] {
  return MATERIAL_LANGUAGES.filter((l) => materialsForProduct(product, l).length > 0);
}

/** Физический товар выдаётся не файлом; цифровой без файлов продавать нельзя. */
export function productSellable(product: ProductWithFiles | null | undefined): boolean {
  if (!product) return false;
  if (product.fulfillment_kind === "physical") return true;
  return materialLanguages(product).length > 0;
}
