import type { TenantContext } from "@/core/tenant/resolve.server";
import type { LaunchCourse, LaunchInput } from "@/core/courses/launch";
import { courseProducts, schoolStudents } from "./students.server";

/** Курсы магазина для чеклиста запуска и проверки переезда: уроки и канал. */
export async function launchCourses(ctx: TenantContext): Promise<LaunchCourse[]> {
  const { getCourse } = await import("@/core/courses/course.server");
  const out: LaunchCourse[] = [];
  for (const p of await courseProducts(ctx)) {
    const c = await getCourse(ctx, p.id);
    out.push({ name: p.name, lessons: c.lessons.length, channel: Boolean(c.channel) });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Исходные данные чеклиста запуска школы на главной админки. */
export async function schoolLaunchInput(ctx: TenantContext): Promise<LaunchInput> {
  const courses = await launchCourses(ctx);
  const students = (await schoolStudents(ctx)).reduce((n, c) => n + c.students.length, 0);
  return { slug: ctx.tenant.settings.slug ?? null, courses, students };
}
