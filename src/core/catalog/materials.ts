import { isLocale, type Locale } from "@/core/i18n/locale";

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

/**
 * Файлы товара для формы админки. Товар из v1 часто хранит один файл в
 * старых полях file_path / file_path_kz, без строк product_material_files
 * (у Print KZ Art так заведены товары 0001–0027): без этого форма показывала
 * «нет файла» и не давала сохранить товар, хотя бот его продаёт и выдаёт.
 * Ссылка file_url в форму не попадает: у формы есть только файлы хранилища.
 */
export function editableMaterials(
  product: ProductWithFiles | null | undefined,
): Array<{ language: Locale; filePath: string; fileName: string | null }> {
  const rows = (product?.product_material_files ?? [])
    .filter((f) => f.file_path)
    .slice()
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    .map((f) => ({
      language: isLocale(f.language) ? f.language : ("ru" as Locale),
      filePath: f.file_path!,
      fileName: f.file_name ?? null,
    }));
  if (rows.length) return rows;
  const legacy: Array<{ language: Locale; filePath: string; fileName: string | null }> = [];
  if (product?.file_path)
    legacy.push({
      language: "ru",
      filePath: product.file_path,
      fileName: product.file_name ?? null,
    });
  if (product?.file_path_kz)
    legacy.push({
      language: "kk",
      filePath: product.file_path_kz,
      fileName: product.file_name_kz ?? null,
    });
  return legacy;
}

/** Сколько файлов выдаст товар по всем языкам — с учётом старых полей v1. */
export function materialCount(product: ProductWithFiles | null | undefined): number {
  return MATERIAL_LANGUAGES.reduce((n, l) => n + materialsForProduct(product, l).length, 0);
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

/**
 * Выбор языка материалов ДО оформления (настройка `delivery_lang_timing` =
 * "before"): конкретный язык или «все» — тогда позиция стоит ×N по числу
 * языков, реально заведённых у ЭТОГО товара (как N комплектов), а не по
 * числу языков системы: товар с одним языком не станет стоить 4x.
 */
export type DeliveryLangChoice = Locale | "all";

export function isDeliveryLangChoice(value: unknown): value is DeliveryLangChoice {
  return value === "all" || (typeof value === "string" && isLocale(value));
}

export function deliveryPriceMultiplier(
  choice: DeliveryLangChoice | null | undefined,
  availableLangsCount: number,
): number {
  if (choice !== "all") return 1;
  return Math.max(1, availableLangsCount);
}

/**
 * Языки, уже отправленные покупателю по позиции (`order_items.delivered_language`):
 * список кодов через запятую; «both» — исторический синоним ru+kk у старых заказов.
 */
export function parseDeliveredLanguages(raw: string | null | undefined): Set<Locale> {
  if (!raw) return new Set();
  if (raw === "both") return new Set(["ru", "kk"]);
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim())
      .filter(isLocale),
  );
}

export function addDeliveredLanguage(raw: string | null | undefined, lang: Locale): string {
  const set = parseDeliveredLanguages(raw);
  set.add(lang);
  return MATERIAL_LANGUAGES.filter((l) => set.has(l)).join(",");
}
