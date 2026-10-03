import { nextOpening } from "@/core/courses/access";
import { issueCertificate } from "@/core/courses/certificate.server";
import { isCourseToken } from "@/core/courses/link";
import {
  coursePurchase,
  markLesson,
  purchaseTimeline,
  startRun,
  type CoursePurchase,
} from "@/core/courses/run.server";
import { isTenantStorageKey } from "@/core/storage/keys";
import type { Homework, HomeworkStatus } from "@/core/courses/homework";
import { purchaseHomework } from "@/core/courses/homework.server";
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

export type LessonHomeworkView = {
  task: string;
  /** null — ещё не сдано. */
  status: HomeworkStatus | null;
  feedback: { text: string; at: string; status: HomeworkStatus } | null;
  /** Последняя сдача: что ученик уже отправил. */
  last: { at: string; text: string; files: Array<{ name: string; url: string }> } | null;
  /** Проверка ДЗ входит в тариф: иначе задание видно, сдать нельзя. */
  canSubmit: boolean;
};

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
    /** Домашнее задание открытого урока; null — у урока его нет. */
    homework: LessonHomeworkView | null;
  }>;
  doneCount: number;
  nextAt: string | null;
  /** У курса есть закрытый канал: ученик берёт личную ссылку кнопкой. */
  channel: boolean;
  /** Поток: название и старт (ISO); null — курс без потоков. */
  cohort: { title: string; start: string } | null;
  beforeStart: boolean;
  /** До когда открыт доступ; null — бессрочно. */
  expiresAt: string | null;
  expired: boolean;
  /** Код сертификата, когда курс пройден (core/courses/certificate); иначе null. */
  certificate: string | null;
};

export async function courseView(
  ctx: TenantContext,
  p: CoursePurchase,
  sign: FileSigner,
  now = new Date(),
): Promise<CourseView> {
  // Отсчёт расписания — со старта потока или с первого открытия страницы.
  const run = await startRun(ctx, p, now);
  const tl = purchaseTimeline(ctx, { ...p, run }, now);
  const access = tl.access;
  const done = new Set(run.done);
  const hasHomework = p.course.lessons.some((l) => l.homework);
  const submitted = hasHomework ? await purchaseHomework(ctx, p.orderItemId) : new Map();
  const lessons: CourseView["lessons"] = [];
  for (const a of access) {
    const files: Array<{ name: string; url: string }> = [];
    if (a.open)
      for (const f of a.lesson.files) {
        // Курс пишется только с путями своего магазина (courseProblem), но
        // строке в базе не верим: чужой префикс не подписываем, как в #89.
        if (!isTenantStorageKey(ctx.tenant.id, f.path)) continue;
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
      homework:
        a.open && a.lesson.homework
          ? await homeworkView(
              ctx,
              a.lesson.homework,
              submitted.get(a.lesson.id) ?? null,
              sign,
              tl.tariff.homework,
            )
          : null,
    });
  }
  const cert = await issueCertificate(ctx, { ...p, run }, now).catch(() => null);
  return {
    name: p.name,
    lessons,
    doneCount: lessons.filter((l) => l.done).length,
    channel: Boolean(p.course.channel) && tl.tariff.channel && !tl.expired,
    nextAt: tl.expired ? null : (nextOpening(access)?.opensAt ?? null),
    cohort: tl.cohort ? { title: tl.cohort.title, start: tl.start } : null,
    beforeStart: tl.beforeStart,
    expiresAt: tl.expiresAt,
    expired: tl.expired,
    certificate: cert?.certificate.code ?? null,
  };
}

export async function setLessonDone(
  ctx: TenantContext,
  p: CoursePurchase,
  lessonId: string,
  done: boolean,
  now = new Date(),
): Promise<{ done: string[]; certificate: string | null }> {
  const run = await markLesson(ctx, p, lessonId, done, now);
  // Последний урок отмечен — курс без проверяемых заданий окончен.
  const cert = done ? await issueCertificate(ctx, { ...p, run }, now).catch(() => null) : null;
  return { done: run.done, certificate: cert?.certificate.code ?? null };
}

async function homeworkView(
  ctx: TenantContext,
  task: string,
  hw: Homework | null,
  sign: FileSigner,
  canSubmit: boolean,
): Promise<LessonHomeworkView> {
  const last = hw?.attempts.at(-1) ?? null;
  const files: Array<{ name: string; url: string }> = [];
  for (const f of last?.files ?? []) {
    // Свой ответ ученик видит только из своей папки своего магазина.
    if (!isTenantStorageKey(ctx.tenant.id, f.path)) continue;
    const url = await sign(f.path, f.name);
    if (url) files.push({ name: f.name ?? f.path.split("/").pop() ?? "", url });
  }
  return {
    task,
    status: hw?.status ?? null,
    feedback: hw?.feedback
      ? { text: hw.feedback.text, at: hw.feedback.at, status: hw.feedback.status }
      : null,
    last: last ? { at: last.at, text: last.text, files } : null,
    canSubmit,
  };
}
