import type { TenantContext } from "@/core/tenant/resolve.server";
import { cohortStart, enrollingCohort, enrollOpen, type Tariff } from "./cohort";
import { courseKey, parseCourse } from "./course";
import { readSetting } from "./db.server";

/**
 * Курс на витрине до покупки: программа (названия уроков без содержимого),
 * расписание, ближайший поток, что входит в тарифы и идёт ли набор. Только
 * то, что и так видно покупателю: текст, файлы и ссылки уроков не уходят.
 */
export type CoursePreview = {
  lessons: Array<{ no: number; title: string; homework: boolean }>;
  everyDays: number | null;
  cohort: { title: string; start: string } | null;
  enrollOpen: boolean;
  channel: boolean;
  /** Тарифы по id варианта; нет записи — всё включено, бессрочно. */
  tariffs: Record<string, Tariff>;
};

export async function coursePreview(
  ctx: TenantContext,
  productId: string,
  now = new Date(),
): Promise<CoursePreview | null> {
  if (!ctx.tenant.modules.courses) return null;
  const course = parseCourse(await readSetting(ctx, courseKey(productId)));
  if (course.lessons.length === 0) return null;
  const next = enrollingCohort(course, now, ctx.timezone);
  return {
    lessons: course.lessons.map((l, i) => ({
      no: i + 1,
      title: l.title,
      homework: Boolean(l.homework),
    })),
    everyDays: course.schedule.mode === "drip" ? course.schedule.everyDays : null,
    cohort: next
      ? { title: next.title, start: cohortStart(next, ctx.timezone).toISOString() }
      : null,
    enrollOpen: enrollOpen(course, now, ctx.timezone),
    channel: Boolean(course.channel),
    tariffs: course.tariffs ?? {},
  };
}
