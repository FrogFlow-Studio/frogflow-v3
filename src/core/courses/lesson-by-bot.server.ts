import { pageAll } from "@/core/db/page";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { LESSON_VIDEOS_MAX, lessonLinks, LESSONS_MAX } from "./course";
import { lessonIndexByNumber, lessonNumberOf } from "./lesson-by-bot";
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
  | { ok: true; no: number; title: string; appended: boolean; video?: number }
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
  // Куда добавить: урок с номером из подписи («1.1» → «Модуль 1 · 1.1. …»),
  // иначе последний урок, если подпись та же (несколько видео подряд).
  const num = lessonNumberOf(lesson.title);
  let at = num
    ? lessonIndexByNumber(
        course.lessons.map((l) => l.title),
        num,
      )
    : -1;
  if (at < 0 && lesson.title && course.lessons.at(-1)?.title === lesson.title)
    at = course.lessons.length - 1;
  const target = at >= 0 ? course.lessons[at]! : null;
  if (target) {
    const all = (target.tgVideos?.length ?? 0) + lessonLinks(target).length;
    if (all >= LESSON_VIDEOS_MAX) return { ok: false, reason: "videosFull" };
    const next = lesson.tgVideo
      ? { ...target, tgVideos: [...(target.tgVideos ?? []), lesson.tgVideo] }
      : target.link
        ? { ...target, videos: [...(target.videos ?? []), lesson.link!] }
        : { ...target, link: lesson.link! };
    await saveCourse(ctx, productId, {
      ...course,
      lessons: course.lessons.map((l, i) => (i === at ? next : l)),
    });
    return {
      ok: true,
      no: at + 1,
      title: target.title,
      appended: true,
      ...(lesson.tgVideo ? { video: next.tgVideos!.length - 1 } : {}),
    };
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
  return { ok: true, no, title, appended: false, ...(lesson.tgVideo ? { video: 0 } : {}) };
}

/** Курсы, где есть урок с номером из подписи: если такой курс один — спрашивать не нужно. */
export async function coursesWithNumber(
  ctx: TenantContext,
  courses: Array<{ id: string; name: string }>,
  caption: string,
): Promise<Array<{ id: string; name: string }>> {
  const num = lessonNumberOf(caption);
  if (!num) return [];
  const out: Array<{ id: string; name: string }> = [];
  for (const c of courses) {
    const course = await getCourse(ctx, c.id);
    if (
      lessonIndexByNumber(
        course.lessons.map((l) => l.title),
        num,
      ) >= 0
    )
      out.push(c);
  }
  return out;
}

/** Убрать видео из бота у урока (кнопка «Убрать видео» под ответом продавцу). */
export async function removeBotVideo(
  ctx: TenantContext,
  productId: string,
  no: number,
  video: number,
  tail: string,
): Promise<boolean> {
  const course = await getCourse(ctx, productId);
  const l = course.lessons[no - 1];
  if (!l?.tgVideos?.[video]?.endsWith(tail)) return false;
  const tgVideos = l.tgVideos.filter((_, i) => i !== video);
  const next = { ...l, tgVideos };
  // Урок, где кроме этого видео ничего не было, — убираем целиком (пустой урок курс не сохранит).
  const empty =
    !next.text.trim() &&
    !lessonLinks(next).length &&
    !tgVideos.length &&
    !next.files.length &&
    !next.quiz;
  await saveCourse(ctx, productId, {
    ...course,
    lessons: empty
      ? course.lessons.filter((_, i) => i !== no - 1)
      : course.lessons.map((x, i) => (i === no - 1 ? next : x)),
  });
  return true;
}
