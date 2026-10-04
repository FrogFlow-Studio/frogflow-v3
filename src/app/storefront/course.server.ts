import { videoEmbed } from "@/core/courses/video";
import { liveSchedule, type LiveView } from "@/core/courses/live-view";
import { nextOpening } from "@/core/courses/access";
import { issueCertificate } from "@/core/courses/certificate.server";
import { readSettings } from "@/core/courses/db.server";
import { isCourseToken } from "@/core/courses/link";
import { parseQuizResult, publicQuiz, quizKey, type PublicQuiz } from "@/core/courses/lesson-quiz";
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

export type LessonQuizView = PublicQuiz & {
  /** Сколько попыток уже сделано: по нему сервер принимает следующую (без дублей). */
  attempts: number;
  /** Попыток было до последнего сброса продавцом: лимит считается после них. */
  from: number;
  passed: boolean;
  /** Лучший результат, процентов. */
  best: number;
  last: { score: number; total: number } | null;
};

export type CourseView = {
  name: string;
  lessons: Array<{
    id: string;
    no: number;
    title: string;
    open: boolean;
    opensAt: string;
    /** Урок ждёт ДЗ предыдущего, а не даты (режим «по заданиям»). */
    gated: boolean;
    done: boolean;
    /** У закрытого урока — пусто: текст, ссылка и файлы не уходят в браузер. */
    text: string;
    link: string | null;
    /** Адрес встроенного плеера для ссылки на видео (core/courses/video); иначе null. */
    embed: string | null;
    files: Array<{ name: string; url: string }>;
    /** Тест к уроку (без верных ответов); null — у урока его нет. */
    quiz: LessonQuizView | null;
    /** Домашнее задание открытого урока; null — у урока его нет. */
    homework: LessonHomeworkView | null;
  }>;
  doneCount: number;
  nextAt: string | null;
  /** У курса есть закрытый канал: ученик берёт личную ссылку кнопкой. */
  channel: boolean;
  /** У потока ученика есть групповой чат: своя личная ссылка. */
  chat: boolean;
  /** Поток: название и старт (ISO); null — курс без потоков. */
  cohort: { title: string; start: string } | null;
  beforeStart: boolean;
  /** До когда открыт доступ; null — бессрочно. */
  expiresAt: string | null;
  expired: boolean;
  /** Код сертификата, когда курс пройден (core/courses/certificate); иначе null. */
  certificate: string | null;
  /** Эфиры потока (core/courses/live-view): ссылка только у начинающихся и идущих. */
  lives: LiveView[];
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
  const quizKeys = p.course.lessons.flatMap((l) => (l.quiz ? [quizKey(p.orderItemId, l.id)] : []));
  const quizRaw = quizKeys.length ? await readSettings(ctx, quizKeys) : new Map<string, string>();
  const lessons: CourseView["lessons"] = [];
  for (const a of access) {
    let quiz: LessonQuizView | null = null;
    if (a.open && a.lesson.quiz) {
      const r = parseQuizResult(quizRaw.get(quizKey(p.orderItemId, a.lesson.id)));
      const last = r.log.at(-1);
      quiz = {
        ...publicQuiz(a.lesson.quiz),
        attempts: r.attempts,
        from: r.from,
        passed: r.passed,
        best: r.best,
        last: last ? { score: last.score, total: last.total } : null,
      };
    }
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
      gated: Boolean(a.gated) && !a.open,
      done: a.open && done.has(a.lesson.id),
      text: a.open ? a.lesson.text : "",
      link: a.open ? a.lesson.link : null,
      embed: a.open && a.lesson.link ? videoEmbed(a.lesson.link) : null,
      files,
      quiz,
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
    chat: Boolean(tl.cohort?.chat) && tl.tariff.channel && !tl.expired,
    nextAt: tl.expired ? null : (nextOpening(access)?.opensAt ?? null),
    cohort: tl.cohort ? { title: tl.cohort.title, start: tl.start } : null,
    beforeStart: tl.beforeStart,
    expiresAt: tl.expiresAt,
    expired: tl.expired,
    certificate: cert?.certificate.code ?? null,
    lives: liveSchedule(tl, ctx.timezone, now),
  };
}

export async function setLessonDone(
  ctx: TenantContext,
  p: CoursePurchase,
  lessonId: string,
  done: boolean,
  now = new Date(),
): Promise<{ done: string[]; certificate: string | null }> {
  // Урок с тестом отмечает только пройденный тест: вручную не пропустить и не снять.
  if (p.course.lessons.find((l) => l.id === lessonId)?.quiz) {
    const run = p.run ?? (await startRun(ctx, p, now));
    return { done: run.done, certificate: null };
  }
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
