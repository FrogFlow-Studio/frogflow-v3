import { isTenantStorageKey } from "@/core/storage/keys";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { cohortStart, enrollingCohort, enrollOpen, type Tariff } from "./cohort";
import { courseKey, parseCourse, type Lesson } from "./course";
import { readSetting } from "./db.server";

/** Ссылка на файл открытого урока; null — не удалось подписать, файл пропускается. */
export type PreviewSigner = (path: string, name: string | null) => Promise<string | null>;

/**
 * Адрес файла открытого урока на нашем маршруте (`no` — номер урока с единицы,
 * `idx` — номер файла с нуля). Подпись хранилища ставится в момент перехода
 * (`openLessonFile`), а не при показе карточки: ссылка на странице не
 * протухает и не раздаёт подписанные адреса всем, кто открыл страницу.
 */
export type PreviewFileLink = (no: number, idx: number) => string;

/** Содержимое открытого урока: без задания ДЗ. */
export type OpenLesson = {
  text: string;
  link: string | null;
  files: Array<{ name: string; url: string }>;
};

/**
 * Курс на витрине до покупки: программа (названия уроков), расписание,
 * ближайший поток, что входит в тарифы и идёт ли набор. Содержимое — только у
 * уроков с галочкой «Открытый урок»: у остальных текст, файлы и ссылки не
 * уходят, а файлы закрытых уроков не подписываются вовсе.
 */
export type CoursePreview = {
  lessons: Array<{ no: number; title: string; homework: boolean; open: OpenLesson | null }>;
  everyDays: number | null;
  /** Режим «по заданиям»: следующий урок — после принятого (accepted) или сданного ДЗ. */
  afterTask: "accepted" | "submitted" | null;
  cohort: { title: string; start: string } | null;
  enrollOpen: boolean;
  channel: boolean;
  /** Тарифы по id варианта; нет записи — всё включено, бессрочно. */
  tariffs: Record<string, Tariff>;
};

async function openContent(
  ctx: TenantContext,
  l: Lesson,
  no: number,
  files: { sign?: PreviewSigner; link?: PreviewFileLink },
): Promise<OpenLesson | null> {
  if (!l.preview) return null;
  const out: OpenLesson["files"] = [];
  for (const [idx, f] of l.files.entries()) {
    // Путь из базы не доверенный: чужой префикс не показываем и не подписываем (как в #89).
    if (!isTenantStorageKey(ctx.tenant.id, f.path)) continue;
    const name = f.name ?? f.path.split("/").pop() ?? "";
    if (files.link) {
      out.push({ name, url: files.link(no, idx) });
      continue;
    }
    if (!files.sign) continue;
    const url = await files.sign(f.path, f.name).catch(() => null);
    if (url) out.push({ name, url });
  }
  return { text: l.text, link: l.link, files: out };
}

/**
 * Подписанная ссылка на файл открытого урока в момент перехода. Только
 * урок с галочкой «Открытый урок», только файл с путём этого магазина;
 * закрытый урок, чужой путь, несуществующий номер — null.
 */
export async function openLessonFile(
  ctx: TenantContext,
  productId: string,
  no: number,
  idx: number,
  sign: PreviewSigner,
): Promise<string | null> {
  if (!ctx.tenant.modules.courses) return null;
  const course = parseCourse(await readSetting(ctx, courseKey(productId)));
  const l = course.lessons[no - 1];
  const f = l?.preview ? l.files[idx] : undefined;
  if (!f || !isTenantStorageKey(ctx.tenant.id, f.path)) return null;
  return sign(f.path, f.name).catch(() => null);
}

/** Открытый урок по номеру (с единицы) для бота; закрытый или чужой товар — null. */
export async function previewLesson(
  ctx: TenantContext,
  productId: string,
  no: number,
  sign: PreviewSigner,
): Promise<{ title: string; open: OpenLesson } | null> {
  if (!ctx.tenant.modules.courses) return null;
  const course = parseCourse(await readSetting(ctx, courseKey(productId)));
  const l = course.lessons[no - 1];
  if (!l) return null;
  const open = await openContent(ctx, l, no, { sign });
  return open ? { title: l.title, open } : null;
}

export async function coursePreview(
  ctx: TenantContext,
  productId: string,
  now = new Date(),
  link?: PreviewFileLink,
): Promise<CoursePreview | null> {
  if (!ctx.tenant.modules.courses) return null;
  const course = parseCourse(await readSetting(ctx, courseKey(productId)));
  if (course.lessons.length === 0) return null;
  const next = enrollingCohort(course, now, ctx.timezone);
  const lessons: CoursePreview["lessons"] = [];
  for (const [i, l] of course.lessons.entries())
    lessons.push({
      no: i + 1,
      title: l.title,
      homework: Boolean(l.homework),
      open: await openContent(ctx, l, i + 1, { link }),
    });
  return {
    lessons,
    everyDays: course.schedule.mode === "drip" ? course.schedule.everyDays : null,
    afterTask: course.schedule.mode === "tasks" ? course.schedule.unlock : null,
    cohort: next
      ? { title: next.title, start: cohortStart(next, ctx.timezone).toISOString() }
      : null,
    enrollOpen: enrollOpen(course, now, ctx.timezone),
    channel: Boolean(course.channel),
    tariffs: course.tariffs ?? {},
  };
}
