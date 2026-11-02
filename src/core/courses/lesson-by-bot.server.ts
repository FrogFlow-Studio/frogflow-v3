import { pageAll } from "@/core/db/page";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { lessonLinks, LESSONS_MAX } from "./course";
import { getCourse, saveCourse } from "./course.server";
import { COURSE_MARKER_URL } from "./marker";

/** Курсы магазина с уроками (метка курса на товаре), по названию. */
export async function lessonCourses(
  ctx: TenantContext,
): Promise<Array<{ id: string; name: string }>> {
  return pageAll<{ id: string; name: string }>(
    (from, to) =>
      ctx.db
        .from("products")
        .select("id, name")
        .eq("file_url", COURSE_MARKER_URL)
        .order("name")
        .order("id")
        .range(from, to),
    "курсы для урока из бота",
  );
}

export type AddLessonResult = { ok: true; no: number } | { ok: false; reason: "full" | "again" };

/**
 * Новый урок в конец курса — тем же `saveCourse`, что карточка курса в
 * панели (те же проверки). Название пустое — «Урок N».
 */
export async function addLessonByBot(
  ctx: TenantContext,
  productId: string,
  lesson: { title: string; link: string },
  fallbackTitle: (no: number) => string,
): Promise<AddLessonResult> {
  const course = await getCourse(ctx, productId);
  // Повтор той же ссылки (второе нажатие кнопки, пересланное дважды) — не второй урок.
  if (course.lessons.some((l) => lessonLinks(l).includes(lesson.link)))
    return { ok: false, reason: "again" };
  if (course.lessons.length >= LESSONS_MAX) return { ok: false, reason: "full" };
  const no = course.lessons.length + 1;
  await saveCourse(ctx, productId, {
    ...course,
    lessons: [
      ...course.lessons,
      {
        id: crypto.randomUUID(),
        title: lesson.title || fallbackTitle(no),
        text: "",
        files: [],
        link: lesson.link,
      },
    ],
  });
  return { ok: true, no };
}
