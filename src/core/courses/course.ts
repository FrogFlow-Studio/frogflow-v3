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
/** Текст домашнего задания урока (ниша «Онлайн-школа»). */
export const HOMEWORK_TASK_MAX = 2000;
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
  /** Домашнее задание: текст задания; нет — урок без ДЗ (core/courses/homework). */
  homework?: string | null;
  /** Открытый урок: текст, ссылка и файлы видны до покупки (core/courses/preview). */
  preview?: boolean;
};
/**
 * Когда следующий урок открывается после ДЗ предыдущего (режим «по заданиям»):
 * accepted — когда преподаватель принял работу, submitted — когда ученик сдал.
 */
export type HwUnlock = "accepted" | "submitted";
/**
 * all — все уроки сразу после оплаты; drip — по одному раз в everyDays дней;
 * tasks — первый урок со стартом, следующий — после ДЗ предыдущего
 * (core/courses/access).
 */
export type CourseSchedule =
  { mode: "all" } | { mode: "drip"; everyDays: number } | { mode: "tasks"; unlock: HwUnlock };
export const HOMEWORK_DAYS_MAX = 60;
export const COHORTS_MAX = 20;
export const COHORT_TITLE_MAX = 100;
export const ACCESS_DAYS_MAX = 3650;
export const LOCAL_START_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
export const LOCAL_DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export type Course = {
  schedule: CourseSchedule;
  lessons: Lesson[];
  /** Потоки с общей датой старта (core/courses/cohort); нет — с момента покупки. */
  cohorts?: Cohort[];
  /** Тарифы по id варианта товара: что входит и срок доступа. */
  tariffs?: Record<string, Tariff>;
  /** Срок сдачи задания: дней после открытия урока; после — напоминание. */
  homeworkDays?: number | null;
  /**
   * Закрытый канал или группа курса в Telegram: id (-100…) или @имя. Бот
   * магазина — администратор с правом приглашать; ученик получает
   * одноразовую ссылку (core/courses/channel.server).
   */
  channel?: string | null;
};

/** id канала или группы (-100…) либо публичное @имя. */
export const COURSE_CHANNEL_RE = /^(-100\d{5,15}|@[A-Za-z][A-Za-z0-9_]{4,31})$/;

export const EMPTY_COURSE: Course = { schedule: { mode: "all" }, lessons: [] };

export function courseKey(productId: string): string {
  return `${COURSE_KEY_PREFIX}${productId}`;
}

import type { Cohort, Tariff } from "./cohort";

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
  const o = (v && typeof v === "object" ? v : {}) as {
    mode?: unknown;
    everyDays?: unknown;
    unlock?: unknown;
  };
  if (o.mode === "tasks")
    return { mode: "tasks", unlock: o.unlock === "submitted" ? "submitted" : "accepted" };
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
  const o = obj as {
    schedule?: unknown;
    lessons?: unknown;
    channel?: unknown;
    cohorts?: unknown;
    tariffs?: unknown;
    homeworkDays?: unknown;
  };
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
    const homework = str(x.homework, HOMEWORK_TASK_MAX);
    lessons.push({
      id,
      title,
      text: str(x.text, LESSON_TEXT_MAX),
      files: files.slice(0, LESSON_FILES_MAX),
      link: link && isHttpsLink(link) ? link : null,
      ...(homework ? { homework } : {}),
      ...(x.preview === true ? { preview: true } : {}),
    });
    if (lessons.length >= LESSONS_MAX) break;
  }
  const channel = str(o.channel, 40);
  const cohorts = parseCohorts(o.cohorts);
  const tariffs = parseTariffs(o.tariffs);
  const hwDays = Math.round(Number(o.homeworkDays));
  return {
    schedule: parseSchedule(o.schedule),
    lessons,
    ...(COURSE_CHANNEL_RE.test(channel) ? { channel } : {}),
    ...(cohorts.length ? { cohorts } : {}),
    ...(Object.keys(tariffs).length ? { tariffs } : {}),
    ...(hwDays >= 1 && hwDays <= HOMEWORK_DAYS_MAX ? { homeworkDays: hwDays } : {}),
  };
}

function parseCohorts(v: unknown): Cohort[] {
  const out: Cohort[] = [];
  for (const c of Array.isArray(v) ? v : []) {
    const x = (c ?? {}) as Record<string, unknown>;
    const id = str(x.id, 36);
    const start = str(x.start, 16);
    const until = str(x.enrollUntil, 10);
    if (!UUID.test(id) || !LOCAL_START_RE.test(start) || out.some((o) => o.id === id)) continue;
    out.push({
      id,
      title: str(x.title, COHORT_TITLE_MAX),
      start,
      enrollUntil: LOCAL_DAY_RE.test(until) ? until : null,
      ...(COURSE_CHANNEL_RE.test(str(x.chat, 40).trim()) ? { chat: str(x.chat, 40).trim() } : {}),
    });
    if (out.length >= COHORTS_MAX) break;
  }
  return out;
}

function parseTariffs(v: unknown): Record<string, Tariff> {
  const out: Record<string, Tariff> = {};
  if (!v || typeof v !== "object" || Array.isArray(v)) return out;
  for (const [id, t] of Object.entries(v as Record<string, unknown>)) {
    if (!UUID.test(id) || !t || typeof t !== "object") continue;
    const x = t as Record<string, unknown>;
    const days = Math.round(Number(x.accessDays));
    out[id] = {
      homework: x.homework !== false,
      channel: x.channel !== false,
      accessDays: days >= 1 && days <= ACCESS_DAYS_MAX ? days : null,
    };
  }
  return out;
}

export type CourseProblem =
  | { kind: "tooMany" }
  | { kind: "noTitle"; lesson: number }
  | { kind: "duplicateId"; lesson: number }
  | { kind: "badLink"; lesson: number }
  | { kind: "tooManyFiles"; lesson: number }
  | { kind: "foreignFile"; lesson: number }
  | { kind: "empty"; lesson: number }
  | { kind: "badSchedule" }
  | { kind: "badChannel" }
  | { kind: "badCohort"; cohort: number }
  | { kind: "badTariff" };

/**
 * Проверка курса перед записью. Номер урока в ответе — с единицы, как его
 * видит продавец. Файл должен лежать под префиксом этого клиента: чужой ключ
 * из запроса не должен попасть в выдачу.
 */
export function courseProblem(tenantId: string, c: Course): CourseProblem | null {
  if (c.lessons.length > LESSONS_MAX) return { kind: "tooMany" };
  if (c.schedule.mode === "tasks" && !["accepted", "submitted"].includes(c.schedule.unlock))
    return { kind: "badSchedule" };
  if (
    c.schedule.mode === "drip" &&
    !(
      Number.isInteger(c.schedule.everyDays) &&
      c.schedule.everyDays >= DRIP_DAYS_MIN &&
      c.schedule.everyDays <= DRIP_DAYS_MAX
    )
  )
    return { kind: "badSchedule" };
  if (c.channel?.trim() && !COURSE_CHANNEL_RE.test(c.channel.trim())) return { kind: "badChannel" };
  if ((c.cohorts?.length ?? 0) > COHORTS_MAX) return { kind: "badCohort", cohort: COHORTS_MAX + 1 };
  const cohortIds = new Set<string>();
  for (const [i, k] of (c.cohorts ?? []).entries()) {
    const bad =
      !UUID.test(k.id) ||
      cohortIds.has(k.id) ||
      !LOCAL_START_RE.test(k.start) ||
      !Number.isFinite(Date.parse(`${k.start}:00Z`)) ||
      (k.enrollUntil != null &&
        (!LOCAL_DAY_RE.test(k.enrollUntil) || !Number.isFinite(Date.parse(k.enrollUntil)))) ||
      k.title.length > COHORT_TITLE_MAX ||
      Boolean(k.chat?.trim() && !COURSE_CHANNEL_RE.test(k.chat.trim()));
    if (bad) return { kind: "badCohort", cohort: i + 1 };
    cohortIds.add(k.id);
  }
  for (const [id, t] of Object.entries(c.tariffs ?? {}))
    if (
      !UUID.test(id) ||
      (t.accessDays != null &&
        !(Number.isInteger(t.accessDays) && t.accessDays >= 1 && t.accessDays <= ACCESS_DAYS_MAX))
    )
      return { kind: "badTariff" };
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

/**
 * Через сколько дней после оплаты открывается урок с индексом `index` (с нуля).
 * В режиме «по заданиям» дни не считаются: урок ждёт ДЗ предыдущего.
 */
export function lessonOpensAfterDays(schedule: CourseSchedule, index: number): number {
  return schedule.mode === "drip" ? index * schedule.everyDays : 0;
}

/** Все файлы курса — чтобы убрать их из бакета вместе с товаром. */
export function courseFilePaths(c: Course): string[] {
  return c.lessons.flatMap((l) => l.files.map((f) => f.path));
}
