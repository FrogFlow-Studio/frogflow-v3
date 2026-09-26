import type { Database } from "@/core/db-types";
import type { Locale } from "@/core/i18n/locale";
import { parseDeliveredLanguages, type MaterialSnapshot } from "@/core/catalog/materials";

/** Чистые функции заказа — без импорта базы, можно в клиентский бандл. */
type OrderRow = Database["public"]["Tables"]["orders"]["Row"];
type OrderItemRow = Database["public"]["Tables"]["order_items"]["Row"];

/**
 * Можно ли покупателю ещё раз получить файлы заказа: только выданный
 * цифровой. Физический заказ выдаёт продавец — повтор вернул бы его в
 * «оплачен» и запустил бы выдачу материалов.
 */
export function canResendMaterials(o: Pick<OrderRow, "status" | "fulfillment_kind">): boolean {
  return o.status === "delivered" && o.fulfillment_kind !== "physical";
}

/** Номер для покупателя — замороженный display_no, не перенумеровываемый order_no. */
export function displayNo(o: Pick<OrderRow, "id" | "order_no" | "display_no">): number {
  return Number(o.display_no ?? o.order_no ?? o.id);
}

/** Снимок из jsonb старого заказа: только записи с путём или ссылкой. */
function snapshotList(raw: unknown): MaterialSnapshot[] {
  if (!Array.isArray(raw)) return [];
  const str = (v: unknown) => (typeof v === "string" && v ? v : null);
  return raw.flatMap((m: unknown) => {
    if (!m || typeof m !== "object") return [];
    const r = m as Record<string, unknown>;
    const path = str(r.path);
    const url = str(r.url);
    return path || url ? [{ path, name: str(r.name), url }] : [];
  });
}

/**
 * Файлы позиции заказа на языке. Откат как в v1 (materialsForOrderItem):
 * карта по языкам (заказы после MIGRATION-37) → старые ru/kk снимки
 * material_files_snapshot / material_files_kz_snapshot (там все файлы
 * заказа) → совсем старые одиночные колонки (только первый файл).
 */
export function itemMaterials(item: OrderItemRow, lang: Locale): MaterialSnapshot[] {
  const byLang = item.material_files_by_lang;
  if (byLang && typeof byLang === "object" && !Array.isArray(byLang)) {
    const arr = (byLang as Record<string, unknown>)[lang];
    if (Array.isArray(arr) && arr.length) return arr as MaterialSnapshot[];
  }
  if (lang === "ru" || lang === "kk") {
    const old = snapshotList(
      lang === "ru" ? item.material_files_snapshot : item.material_files_kz_snapshot,
    );
    if (old.length) return old;
  }
  // Совсем старые заказы: одиночные колонки.
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

/**
 * Имя файла, под которым покупатель его скачает. Без него подписанная ссылка
 * отдаёт ключ хранилища («1782643012614-ni1xub.pdf»). Расширение берётся из
 * пути — по нему файл откроется, — запрещённые в именах символы убираются.
 */
export function downloadFileName(displayName: string, storagePath: string): string {
  const extension = storagePath.includes(".") ? storagePath.split(".").pop()!.toLowerCase() : "";
  const base = displayName
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  const safeBase = base || "Материал";
  if (!extension) return safeBase;
  return safeBase.toLowerCase().endsWith(`.${extension}`) ? safeBase : `${safeBase}.${extension}`;
}

/** Имя для скачивания файла позиции: имя материала, иначе имя товара. */
export function materialDownloadName(
  mat: Pick<MaterialSnapshot, "path" | "name">,
  itemName: string | null | undefined,
): string {
  return downloadFileName(mat.name || itemName || "", mat.path ?? "");
}

export function itemLanguages(item: OrderItemRow): Locale[] {
  return (["ru", "kk", "en", "uz"] as const).filter((l) => itemMaterials(item, l).length > 0);
}

/**
 * Языки, доступные к выдаче по позиции. Модуль multi_language выключен —
 * только ru, сколько бы языков ни было заведено у товара.
 */
export function itemAvailableLanguages(
  item: Pick<
    OrderItemRow,
    | "material_files_by_lang"
    | "material_files_snapshot"
    | "material_files_kz_snapshot"
    | "file_path_snapshot"
    | "file_url_snapshot"
    | "file_name_snapshot"
    | "file_path_kz_snapshot"
    | "file_url_kz_snapshot"
    | "file_name_kz_snapshot"
  >,
  multiLanguageOn: boolean,
): Locale[] {
  const row = item as OrderItemRow;
  if (multiLanguageOn) return itemLanguages(row);
  return itemMaterials(row, "ru").length > 0 ? ["ru"] : [];
}

/**
 * Позиция ждёт выбора языка от покупателя: языков больше одного и ни один
 * ещё не отмечен как отправленный. Общая проверка для выдачи (можно ли
 * закрыть заказ) и для ответа покупателя на вопрос о языке (стал ли он
 * последним недостающим) — иначе заказ закрывался «выдан» сразу после
 * отправки самого вопроса, а не файла (Учителя-HIGH).
 */
export function itemNeedsLanguageChoice(
  item:
    | (Partial<
        Pick<
          OrderItemRow,
          | "material_files_by_lang"
          | "material_files_snapshot"
          | "material_files_kz_snapshot"
          | "file_path_snapshot"
          | "file_url_snapshot"
          | "file_name_snapshot"
          | "file_path_kz_snapshot"
          | "file_url_kz_snapshot"
          | "file_name_kz_snapshot"
        >
      > & {
        delivered_language?: string | null;
      })
    | null
    | undefined,
  multiLanguageOn: boolean,
): boolean {
  if (!item) return false;
  const langs = itemAvailableLanguages(item as OrderItemRow, multiLanguageOn);
  if (langs.length <= 1) return false;
  return parseDeliveredLanguages(item.delivered_language).size === 0;
}
