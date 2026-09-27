import type { Database } from "@/core/db-types";
import type { Locale } from "@/core/i18n/locale";
import { parseDeliveredLanguages, type MaterialSnapshot } from "@/core/catalog/materials";

/** Чистые функции заказа — без импорта базы, можно в клиентский бандл. */
type OrderRow = Database["public"]["Tables"]["orders"]["Row"];
type OrderItemRow = Database["public"]["Tables"]["order_items"]["Row"];

/** Статус заказа по-русски — для выгрузки и текстов оператору. */
export const ORDER_STATUS_RU: Record<string, string> = {
  awaiting_payment: "ожидает оплаты",
  awaiting_confirmation: "чек на проверке",
  delivering: "выдаётся",
  delivered: "выдан",
  paid: "оплачен",
  rejected: "отклонён",
  cancelled: "отменён",
  accepted: "принят в работу",
  in_production: "в работе",
  ready: "готов",
};

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

/**
 * Дописывает имя для скачивания к подписанной ссылке. Не через опцию
 * `download` supabase-js: она кодирует имя, а потом прогоняет всю ссылку
 * через encodeURI ещё раз, и кириллица приходит как «%D0%9F…pdf».
 */
export function withDownloadName(signedUrl: string, name: string): string {
  return `${signedUrl}${signedUrl.includes("?") ? "&" : "?"}download=${encodeURIComponent(name)}`;
}

/**
 * Имя для скачивания файла позиции: имя материала, иначе имя товара. Если
 * без своего имени в позиции несколько файлов (`all` — все файлы позиции),
 * они нумеруются «Товар (1).pdf», «Товар (2).pdf», чтобы не совпадать.
 */
export function materialDownloadName(
  mat: Pick<MaterialSnapshot, "path" | "name">,
  itemName: string | null | undefined,
  all: ReadonlyArray<Pick<MaterialSnapshot, "name">> = [mat],
): string {
  if (mat.name) return downloadFileName(mat.name, mat.path ?? "");
  const unnamed = all.filter((m) => !m.name);
  const n = unnamed.indexOf(mat);
  const base = itemName || "Материал";
  return downloadFileName(
    unnamed.length > 1 && n >= 0 ? `${base} (${n + 1})` : base,
    mat.path ?? "",
  );
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

/**
 * Канал заказа по колонке `orders.platform`, как orderPlatform в v1
 * (src/lib/order-platform.ts). CHECK на колонке нет, и у старых заказов
 * встречаются пустые и незнакомые значения — v1 считала их заказами
 * Telegram. Сравнение `platform !== "telegram"` отправляло такой заказ в
 * Instagram/WhatsApp, где диалога нет, и покупатель оставался без ответа.
 * `manual` — заказ, который продавец завёл сам: чата с покупателем нет.
 * `web` — заказ с витрины сайта: чата нет, материалы — на странице заказа
 * по подписанной ссылке и письмом.
 */
export type OrderChannel = "telegram" | "zernio" | "manual" | "web";

export function orderChannel(platform: string | null | undefined): OrderChannel {
  if (platform === "instagram" || platform === "whatsapp") return "zernio";
  if (platform === "manual") return "manual";
  if (platform === "web") return "web";
  return "telegram";
}
