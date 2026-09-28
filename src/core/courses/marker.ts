/**
 * Товар-курс без файлов (ниша «Онлайн-школа», docs/COURSES-NICHE.md).
 *
 * Цифровой товар продаётся, только если ему есть что выдать; у курса вместо
 * файлов — уроки. Схема не меняется (`fulfillment_kind` под CHECK
 * digital|physical), поэтому курс помечается служебной ссылкой в
 * `products.file_url`: каталог, корзина и выбор языка видят «материал на
 * русском» и пускают товар в продажу, а при отправке и показе метка
 * вырезается (`protectMaterials`) — вместо неё уходит ссылка на уроки
 * (core/courses/delivery.server). Чистый модуль: его читает и браузер.
 */
export const COURSE_MARKER_URL = "frogflow:course";

export function isCourseMarker(m: { url?: string | null } | null | undefined): boolean {
  return m?.url === COURSE_MARKER_URL;
}

export function withoutCourseMarker<T extends { url?: string | null }>(list: T[]): T[] {
  return list.some(isCourseMarker) ? list.filter((m) => !isCourseMarker(m)) : list;
}

/** Товар помечен как курс (строка products или её часть). */
export function isCourseProduct(p: { file_url?: string | null } | null | undefined): boolean {
  return p?.file_url === COURSE_MARKER_URL;
}
