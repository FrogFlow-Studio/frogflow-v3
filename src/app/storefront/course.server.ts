import { lessonsAccess, nextOpening } from "@/core/courses/access";
import { isCourseToken } from "@/core/courses/link";
import {
  coursePurchase,
  markLesson,
  startRun,
  type CoursePurchase,
} from "@/core/courses/run.server";
import type { TenantContext } from "@/core/tenant/resolve.server";

/**
 * Страница курса на витрине: покупка по подписанной ссылке, уроки с доступом
 * и отметками. Подпись неверна, заказ не выдан или уроков нет — одно и то же
 * «не найдено»: по ответу нельзя понять, существует ли чужая позиция.
 */
export async function openCourse(
  ctx: TenantContext,
  secret: string,
  itemId: string,
  token: string,
): Promise<CoursePurchase | null> {
  if (!isCourseToken(secret, ctx.tenant.id, itemId, token)) return null;
  return coursePurchase(ctx, itemId);
}

/** Ссылка на файл урока; на сутки — страница открывается заново, ссылки обновляются. */
export type FileSigner = (path: string, name: string | null) => Promise<string | null>;

export type CourseView = {
  name: string;
  lessons: Array<{
    id: string;
    no: number;
    title: string;
    open: boolean;
    opensAt: string;
    done: boolean;
    /** У закрытого урока — пусто: текст, ссылка и файлы не уходят в браузер. */
    text: string;
    link: string | null;
    files: Array<{ name: string; url: string }>;
  }>;
  doneCount: number;
  nextAt: string | null;
};

export async function courseView(
  ctx: TenantContext,
  p: CoursePurchase,
  sign: FileSigner,
  now = new Date(),
): Promise<CourseView> {
  // Отсчёт расписания — с первого открытия страницы.
  const run = await startRun(ctx, p, now);
  const access = lessonsAccess(p.course, run.startedAt, now.getTime());
  const done = new Set(run.done);
  const lessons: CourseView["lessons"] = [];
  for (const a of access) {
    const files: Array<{ name: string; url: string }> = [];
    if (a.open)
      for (const f of a.lesson.files) {
        const url = await sign(f.path, f.name);
        if (url) files.push({ name: f.name ?? f.path.split("/").pop() ?? "", url });
      }
    lessons.push({
      id: a.lesson.id,
      no: a.no,
      title: a.lesson.title,
      open: a.open,
      opensAt: a.opensAt,
      done: a.open && done.has(a.lesson.id),
      text: a.open ? a.lesson.text : "",
      link: a.open ? a.lesson.link : null,
      files,
    });
  }
  return {
    name: p.name,
    lessons,
    doneCount: lessons.filter((l) => l.done).length,
    nextAt: nextOpening(access)?.opensAt ?? null,
  };
}

export async function setLessonDone(
  ctx: TenantContext,
  p: CoursePurchase,
  lessonId: string,
  done: boolean,
  now = new Date(),
): Promise<string[]> {
  return (await markLesson(ctx, p, lessonId, done, now)).done;
}
