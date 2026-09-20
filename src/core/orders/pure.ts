import type { Database } from "@/core/db-types";
import type { Locale } from "@/core/i18n/locale";
import type { MaterialSnapshot } from "@/core/catalog/materials";

/** Чистые функции заказа — без импорта базы, можно в клиентский бандл. */
type OrderRow = Database["public"]["Tables"]["orders"]["Row"];
type OrderItemRow = Database["public"]["Tables"]["order_items"]["Row"];

/** Номер для покупателя — замороженный display_no, не перенумеровываемый order_no. */
export function displayNo(o: Pick<OrderRow, "id" | "order_no" | "display_no">): number {
  return Number(o.display_no ?? o.order_no ?? o.id);
}

export function itemMaterials(item: OrderItemRow, lang: Locale): MaterialSnapshot[] {
  const byLang = item.material_files_by_lang;
  if (byLang && typeof byLang === "object" && !Array.isArray(byLang)) {
    const arr = (byLang as Record<string, unknown>)[lang];
    if (Array.isArray(arr) && arr.length) return arr as MaterialSnapshot[];
  }
  // Старые заказы: одиночные колонки.
  if (lang === "ru" && (item.file_path_snapshot || item.file_url_snapshot)) {
    return [
      { path: item.file_path_snapshot, name: item.file_name_snapshot, url: item.file_url_snapshot },
    ];
  }
  if (lang === "kk" && (item.file_path_kz_snapshot || item.file_url_kz_snapshot)) {
    return [
      {
        path: item.file_path_kz_snapshot,
        name: item.file_name_kz_snapshot,
        url: item.file_url_kz_snapshot,
      },
    ];
  }
  return [];
}

export function itemLanguages(item: OrderItemRow): Locale[] {
  return (["ru", "kk", "en", "uz"] as const).filter((l) => itemMaterials(item, l).length > 0);
}
