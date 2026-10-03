import { pageAll } from "@/core/db/page";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { COURSE_KEY_PREFIX } from "@/core/courses/course";
import { selectIn } from "@/core/courses/db.server";
import { courseStudents, type CourseStudent } from "@/core/courses/progress.server";

/**
 * «Ученики» онлайн-школы: все ученики всех курсов — по курсам, с потоком,
 * тарифом, прогрессом и заданиями. Курс — товар, у которого есть запись
 * `course_<id товара>` с уроками.
 */
const COURSE_KEY_RE = new RegExp(
  `^${COURSE_KEY_PREFIX}([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$`,
  "i",
);

export type SchoolCourse = {
  productId: string;
  name: string;
  total: number;
  students: CourseStudent[];
};

/** Товары-курсы магазина: у товара есть запись `course_<id>` с уроками. */
export async function courseProducts(
  ctx: TenantContext,
): Promise<Array<{ id: string; name: string }>> {
  const keys = await pageAll<{ key: string }>(
    (from, to) =>
      ctx.db
        .from("app_settings")
        .select("key")
        .like("key", `${COURSE_KEY_PREFIX}%`)
        .order("key")
        .range(from, to),
    "курсы магазина",
  );
  const ids = keys.flatMap((k) => {
    const m = COURSE_KEY_RE.exec(k.key);
    return m ? [m[1]!] : [];
  });
  if (ids.length === 0) return [];
  return selectIn<{ id: string; name: string }>("курсы", ids, (chunk) =>
    ctx.db
      .from("products")
      .select("id, name")
      .in("id", chunk as string[]),
  );
}

export async function schoolStudents(ctx: TenantContext): Promise<SchoolCourse[]> {
  const out: SchoolCourse[] = [];
  for (const p of await courseProducts(ctx)) {
    const r = await courseStudents(ctx, p.id);
    if (r.total > 0) out.push({ productId: p.id, name: p.name, ...r });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export type SchoolOverview = {
  courses: number;
  students: number;
  behind: number;
  homeworkWaiting: number;
  /** Ближайший старт потока в будущем: курс, поток, момент (ISO). */
  nextStart: { course: string; cohort: string; at: string } | null;
};

/** Сводка школы для главной админки. */
export async function schoolOverview(
  ctx: TenantContext,
  now = new Date(),
): Promise<SchoolOverview> {
  const courses = await schoolStudents(ctx);
  const { listHomework, waitingCount } = await import("@/core/courses/homework.server");
  const { getCourse } = await import("@/core/courses/course.server");
  const { cohortStart } = await import("@/core/courses/cohort");
  let nextStart: SchoolOverview["nextStart"] = null;
  for (const c of courses) {
    const course = await getCourse(ctx, c.productId);
    for (const k of course.cohorts ?? []) {
      const at = cohortStart(k, ctx.timezone);
      if (at.getTime() > now.getTime() && (!nextStart || at.toISOString() < nextStart.at))
        nextStart = { course: c.name, cohort: k.title, at: at.toISOString() };
    }
  }
  const all = courses.flatMap((c) => c.students);
  return {
    courses: courses.length,
    students: all.length,
    behind: all.filter((s) => s.behind).length,
    homeworkWaiting: waitingCount(await listHomework(ctx)),
    nextStart,
  };
}
