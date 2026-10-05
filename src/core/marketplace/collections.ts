/**
 * Подборки площадки (Л3): «Для школы», «Подарки»… Собирает оператор, показываются на главной
 * площадки; продавец и покупатель только читают. Название на четырёх языках (ru обязателен,
 * остальные по желанию, пустое заменяется русским), состав — до 24 товаров. Чистые правила.
 */
import type { Locale } from "@/core/i18n/locale";
import { SUPPORTED_LOCALES } from "@/core/i18n/locale";

export const COLLECTION_ITEMS_MAX = 24;
export const COLLECTIONS_MAX = 30;
export const COLLECTION_TITLE_MAX = 60;

export type CollectionItem = { shopId: string; productId: string };
export type CollectionTitles = { ru: string } & Partial<Record<Locale, string>>;
export type Collection = {
  id: string;
  title: CollectionTitles;
  items: CollectionItem[];
  position: number;
  published: boolean;
  rev: number;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const clean = (v: unknown) =>
  typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, COLLECTION_TITLE_MAX) : "";

/** Названия: ru обязателен; нет русского — null. */
export function cleanTitles(raw: unknown): CollectionTitles | null {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const ru = clean(o.ru);
  if (!ru) return null;
  const out: CollectionTitles = { ru };
  for (const l of SUPPORTED_LOCALES) if (l !== "ru" && clean(o[l])) out[l] = clean(o[l]);
  return out;
}

/** Название на языке покупателя, иначе русское. */
export function titleFor(titles: CollectionTitles, locale: Locale): string {
  return titles[locale] || titles.ru;
}

/** Состав: пары uuid без повторов, не больше 24; любой не-uuid делает весь список недопустимым. */
export function cleanItems(raw: unknown): CollectionItem[] | null {
  if (!Array.isArray(raw)) return null;
  const out: CollectionItem[] = [];
  for (const v of raw) {
    const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
    const shopId = String(o.shopId ?? o.shop_id ?? "");
    const productId = String(o.productId ?? o.product_id ?? "");
    if (!UUID.test(shopId) || !UUID.test(productId)) return null;
    if (!out.some((x) => x.productId === productId && x.shopId === shopId))
      out.push({ shopId, productId });
  }
  return out.length > COLLECTION_ITEMS_MAX ? null : out;
}

/** Строка таблицы → подборка; битая строка (нет русского названия, мусор в составе) — null. */
export function collectionFromRow(row: Record<string, unknown>): Collection | null {
  const title = cleanTitles(row.title);
  const items = cleanItems(row.items);
  if (!title || !items || typeof row.id !== "string") return null;
  return {
    id: row.id,
    title,
    items,
    position: Number(row.position) || 0,
    published: row.published === true,
    rev: Number(row.rev) || 1,
  };
}
