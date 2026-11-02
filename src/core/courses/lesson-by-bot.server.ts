import { pageAll } from "@/core/db/page";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { LESSON_VIDEOS_MAX, lessonLinks, LESSONS_MAX } from "./course";
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

export type AddLessonResult =
  | { ok: true; no: number; title: string; appended: boolean }
  | { ok: false; reason: "full" | "again" | "videosFull" };

/** Что прислал продавец: ссылку или видео файлом (Telegram file_id), с подписью-названием. */
export type BotLesson = { title: string; link?: string; tgVideo?: string };

/**
 * Новый урок в конец курса — тем же `saveCourse`, что карточка курса в
 * панели (те же проверки). Название пустое — «Урок N». Видео с той же
 * подписью, что последний урок, — ещё одно видео этого урока (три видео
 * подряд с подписью «1.2 Материалы» — один урок с тремя видео).
 */
export async function addLessonByBot(
  ctx: TenantContext,
  productId: string,
  lesson: BotLesson,
  fallbackTitle: (no: number) => string,
): Promise<AddLessonResult> {
  const course = await getCourse(ctx, productId);
  // Повтор того же (второе нажатие кнопки, пересланное дважды) — не второй урок.
  const seen = course.lessons.some(
    (l) =>
      (lesson.link && lessonLinks(l).includes(lesson.link)) ||
      (lesson.tgVideo && l.tgVideos?.includes(lesson.tgVideo)),
  );
  if (seen) return { ok: false, reason: "again" };
  const last = course.lessons.at(-1);
  if (lesson.tgVideo && last && lesson.title && last.title === lesson.title) {
    const all = (last.tgVideos?.length ?? 0) + lessonLinks(last).length;
    if (all >= LESSON_VIDEOS_MAX) return { ok: false, reason: "videosFull" };
    await saveCourse(ctx, productId, {
      ...course,
      lessons: [
        ...course.lessons.slice(0, -1),
        { ...last, tgVideos: [...(last.tgVideos ?? []), lesson.tgVideo] },
      ],
    });
    return { ok: true, no: course.lessons.length, title: last.title, appended: true };
  }
  if (course.lessons.length >= LESSONS_MAX) return { ok: false, reason: "full" };
  const no = course.lessons.length + 1;
  const title = lesson.title || fallbackTitle(no);
  await saveCourse(ctx, productId, {
    ...course,
    lessons: [
      ...course.lessons,
      {
        id: crypto.randomUUID(),
        title,
        text: "",
        files: [],
        link: lesson.link ?? null,
        ...(lesson.tgVideo ? { tgVideos: [lesson.tgVideo] } : {}),
      },
    ],
  });
  return { ok: true, no, title, appended: false };
}
