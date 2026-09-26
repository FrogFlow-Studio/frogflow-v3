/**
 * Курс (модуль courses) — цифровой товар с уроками по порядку. Схему базы не
 * меняем: сам товар — обычная строка products (fulfillment_kind digital), а
 * уроки лежат JSON-ом в `app_settings` под ключом `course_<id товара>`.
 * Файлы уроков — в бакете product-files под префиксом клиента, так же как
 * материалы; в product_material_files их нет, поэтому обычная выдача после
 * оплаты не отправит покупателю весь курс сразу.
 *
 * Модуль без базы и без node-зависимостей: его читает и редактор в браузере.
 */
import { isTenantStorageKey } from "@/core/storage/keys";

export const COURSE_KEY_PREFIX = "course_";
export const LESSONS_MAX = 100;
export const LESSON_TITLE_MAX = 200;
export const LESSON_TEXT_MAX = 4000;
export const LESSON_FILES_MAX = 10;
export const LESSON_LINK_MAX = 500;
/** Шаг открытия уроков по расписанию, дней. */
export const DRIP_DAYS_MIN = 1;
export const DRIP_DAYS_MAX = 60;

export type CourseFile = { path: string; name: string | null };
export type Lesson = {
  /** Постоянный id урока: по нему потом отмечается «пройден». */
  id: string;
  title: string;
  text: string;
  files: CourseFile[];
  /** Ссылка на внешний материал (видео, документ); только https. */
  link: string | null;
};
/** all — все уроки сразу после оплаты; drip — по одному раз в everyDays дней. */
export type CourseSchedule = { mode: "all" } | { mode: "drip"; everyDays: number };
export type Course = { schedule: CourseSchedule; lessons: Lesson[] };

export const EMPTY_COURSE: Course = { schedule: { mode: "all" }, lessons: [] };

export function courseKey(productId: string): string {
  return `${COURSE_KEY_PREFIX}${productId}`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isHttpsLink(v: string): boolean {
  if (v.length > LESSON_LINK_MAX) return false;
  try {
    return new URL(v).protocol === "https:";
  } catch {
    return false;
  }
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

function parseSchedule(v: unknown): CourseSchedule {
  const o = (v && typeof v === "object" ? v : {}) as { mode?: unknown; everyDays?: unknown };
  const days = Math.round(Number(o.everyDays));
  if (o.mode === "drip" && days >= DRIP_DAYS_MIN && days <= DRIP_DAYS_MAX)
    return { mode: "drip", everyDays: days };
  return { mode: "all" };
}

/**
 * Курс из значения app_settings. Битая запись — пустой курс, битый урок или
 * файл пропускается: читаем то, что писал сам v2, но не падаем на ручной правке.
 */
export function parseCourse(raw: string | null | undefined): Course {
  if (!raw) return { ...EMPTY_COURSE };
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return { ...EMPTY_COURSE };
  }
  if (!obj || typeof obj !== "object") return { ...EMPTY_COURSE };
  const o = obj as { schedule?: unknown; lessons?: unknown };
  const lessons: Lesson[] = [];
  const seen = new Set<string>();
  for (const l of Array.isArray(o.lessons) ? o.lessons : []) {
    if (!l || typeof l !== "object") continue;
    const x = l as Record<string, unknown>;
    const id = str(x.id, 36);
    const title = str(x.title, LESSON_TITLE_MAX);
    if (!UUID.test(id) || seen.has(id) || !title) continue;
    seen.add(id);
    const files: CourseFile[] = [];
    for (const f of Array.isArray(x.files) ? x.files : []) {
      const path = str((f as { path?: unknown })?.path, 500);
      const name = str((f as { name?: unknown })?.name, 200);
      if (path) files.push({ path, name: name || null });
    }
    const link = str(x.link, LESSON_LINK_MAX);
    lessons.push({
      id,
      title,
      text: str(x.text, LESSON_TEXT_MAX),
      files: files.slice(0, LESSON_FILES_MAX),
      link: link && isHttpsLink(link) ? link : null,
    });
    if (lessons.length >= LESSONS_MAX) break;
  }
  return { schedule: parseSchedule(o.schedule), lessons };
}

export type CourseProblem =
  | { kind: "tooMany" }
  | { kind: "noTitle"; lesson: number }
  | { kind: "duplicateId"; lesson: number }
  | { kind: "badLink"; lesson: number }
  | { kind: "tooManyFiles"; lesson: number }
  | { kind: "foreignFile"; lesson: number }
  | { kind: "empty"; lesson: number }
  | { kind: "badSchedule" };

/**
 * Проверка курса перед записью. Номер урока в ответе — с единицы, как его
 * видит продавец. Файл должен лежать под префиксом этого клиента: чужой ключ
 * из запроса не должен попасть в выдачу.
 */
export function courseProblem(tenantId: string, c: Course): CourseProblem | null {
  if (c.lessons.length > LESSONS_MAX) return { kind: "tooMany" };
  if (
    c.schedule.mode === "drip" &&
    !(
      Number.isInteger(c.schedule.everyDays) &&
      c.schedule.everyDays >= DRIP_DAYS_MIN &&
      c.schedule.everyDays <= DRIP_DAYS_MAX
    )
  )
    return { kind: "badSchedule" };
  const ids = new Set<string>();
  for (const [i, l] of c.lessons.entries()) {
    const lesson = i + 1;
    if (!UUID.test(l.id) || ids.has(l.id)) return { kind: "duplicateId", lesson };
    ids.add(l.id);
    if (!l.title.trim()) return { kind: "noTitle", lesson };
    if (l.link && !isHttpsLink(l.link)) return { kind: "badLink", lesson };
    if (l.files.length > LESSON_FILES_MAX) return { kind: "tooManyFiles", lesson };
    if (l.files.some((f) => !isTenantStorageKey(tenantId, f.path)))
      return { kind: "foreignFile", lesson };
    if (!l.text.trim() && !l.link && l.files.length === 0) return { kind: "empty", lesson };
  }
  return null;
}

/** Через сколько дней после оплаты открывается урок с индексом `index` (с нуля). */
export function lessonOpensAfterDays(schedule: CourseSchedule, index: number): number {
  return schedule.mode === "drip" ? index * schedule.everyDays : 0;
}

/** Все файлы курса — чтобы убрать их из бакета вместе с товаром. */
export function courseFilePaths(c: Course): string[] {
  return c.lessons.flatMap((l) => l.files.map((f) => f.path));
}
