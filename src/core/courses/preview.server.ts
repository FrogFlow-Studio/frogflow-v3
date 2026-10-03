import { isTenantStorageKey } from "@/core/storage/keys";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { cohortStart, enrollingCohort, enrollOpen, type Tariff } from "./cohort";
import { courseKey, parseCourse, type Lesson } from "./course";
import { readSetting } from "./db.server";

/** Ссылка на файл открытого урока; null — не удалось подписать, файл пропускается. */
export type PreviewSigner = (path: string, name: string | null) => Promise<string | null>;

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
  cohort: { title: string; start: string } | null;
  enrollOpen: boolean;
  channel: boolean;
  /** Тарифы по id варианта; нет записи — всё включено, бессрочно. */
  tariffs: Record<string, Tariff>;
};

async function openContent(
  ctx: TenantContext,
  l: Lesson,
  sign: PreviewSigner | undefined,
): Promise<OpenLesson | null> {
  if (!l.preview) return null;
  const files: OpenLesson["files"] = [];
  for (const f of l.files) {
    // Путь из базы не доверенный: чужой префикс не подписываем (как в #89).
    if (!sign || !isTenantStorageKey(ctx.tenant.id, f.path)) continue;
    const url = await sign(f.path, f.name).catch(() => null);
    if (url) files.push({ name: f.name ?? f.path.split("/").pop() ?? "", url });
  }
  return { text: l.text, link: l.link, files };
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
  const open = await openContent(ctx, l, sign);
  return open ? { title: l.title, open } : null;
}

export async function coursePreview(
  ctx: TenantContext,
  productId: string,
  now = new Date(),
  sign?: PreviewSigner,
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
      open: await openContent(ctx, l, sign),
    });
  return {
    lessons,
    everyDays: course.schedule.mode === "drip" ? course.schedule.everyDays : null,
    cohort: next
      ? { title: next.title, start: cohortStart(next, ctx.timezone).toISOString() }
      : null,
    enrollOpen: enrollOpen(course, now, ctx.timezone),
    channel: Boolean(course.channel),
    tariffs: course.tariffs ?? {},
  };
}
