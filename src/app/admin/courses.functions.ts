import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  DRIP_DAYS_MAX,
  DRIP_DAYS_MIN,
  HOMEWORK_TASK_MAX,
  LESSON_FILES_MAX,
  LESSON_LINK_MAX,
  LESSON_VIDEOS_MAX,
  LESSON_TEXT_MAX,
  LESSON_TITLE_MAX,
  LESSONS_MAX,
  HOMEWORK_DAYS_MAX,
  ACCESS_DAYS_MAX,
  COHORT_TITLE_MAX,
  COHORTS_MAX,
  LOCAL_DAY_RE,
  LOCAL_START_RE,
  type Course,
} from "@/core/courses/course";
import {
  QUIZ_ATTEMPTS_MAX,
  QUIZ_OPTION_MAX,
  QUIZ_OPTIONS_MAX,
  QUIZ_PAUSE_MAX,
  QUIZ_QUESTIONS_MAX,
  QUIZ_TEXT_MAX,
} from "@/core/courses/lesson-quiz";
import { LIVE_LINK_MAX, LIVE_TITLE_MAX } from "@/core/courses/live";
import { ACCENT_RE, LANDING_BLOCKS, LANDING_LIMITS, LANDING_THEMES } from "@/core/courses/landing";

/**
 * Уроки курса (модуль courses) в карточке цифрового товара. Смотреть может
 * вся команда, менять — менеджер и выше.
 */
const moduleAdmin = async (min?: "manager") =>
  (await import("@/app/auth/guards.server")).requireAdminModule("courses", min);

export const courseFn = createServerFn({ method: "GET" })
  .validator((d: unknown) => z.object({ productId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await moduleAdmin();
    const { getCourse } = await import("@/core/courses/course.server");
    return getCourse(ctx, data.productId);
  });

const lesson = z.object({
  id: z.string().uuid(),
  title: z.string().max(LESSON_TITLE_MAX),
  text: z.string().max(LESSON_TEXT_MAX).default(""),
  files: z
    .array(z.object({ path: z.string().min(1).max(512), name: z.string().max(200).nullable() }))
    .max(LESSON_FILES_MAX)
    .default([]),
  link: z.string().max(LESSON_LINK_MAX).nullable().default(null),
  videos: z
    .array(z.string().max(LESSON_LINK_MAX))
    .max(LESSON_VIDEOS_MAX - 1)
    .optional(),
  tgVideos: z.array(z.string().max(200)).max(LESSON_VIDEOS_MAX).optional(),
  homework: z.string().max(HOMEWORK_TASK_MAX).nullable().optional(),
  preview: z.boolean().optional(),
  quiz: z
    .object({
      pass: z.number().int().min(1).max(100),
      maxAttempts: z.number().int().min(1).max(QUIZ_ATTEMPTS_MAX).optional(),
      pauseMin: z.number().int().min(1).max(QUIZ_PAUSE_MAX).optional(),
      questions: z
        .array(
          z.object({
            text: z.string().max(QUIZ_TEXT_MAX),
            options: z.array(z.string().max(QUIZ_OPTION_MAX)).max(QUIZ_OPTIONS_MAX),
            correct: z.array(z.number().int().min(0).max(QUIZ_OPTIONS_MAX)).max(QUIZ_OPTIONS_MAX),
          }),
        )
        .min(1)
        .max(QUIZ_QUESTIONS_MAX),
    })
    .optional(),
});

const course = z.object({
  schedule: z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("all") }),
    z.object({ mode: z.literal("tasks"), unlock: z.enum(["accepted", "submitted"]) }),
    z.object({
      mode: z.literal("drip"),
      everyDays: z.number().int().min(DRIP_DAYS_MIN).max(DRIP_DAYS_MAX),
    }),
  ]),
  lessons: z.array(lesson).max(LESSONS_MAX),
  channel: z.string().max(40).nullable().optional(),
  homeworkDays: z.number().int().min(1).max(HOMEWORK_DAYS_MAX).nullable().optional(),
  tutor: z.boolean().optional(),
  cohorts: z
    .array(
      z.object({
        id: z.string().uuid(),
        title: z.string().max(COHORT_TITLE_MAX),
        start: z.string().regex(LOCAL_START_RE),
        enrollUntil: z.string().regex(LOCAL_DAY_RE).nullable(),
        chat: z.string().max(40).nullable().optional(),
      }),
    )
    .max(COHORTS_MAX)
    .optional(),
  tariffs: z
    .record(
      z.string().uuid(),
      z.object({
        homework: z.boolean(),
        channel: z.boolean(),
        accessDays: z.number().int().min(1).max(ACCESS_DAYS_MAX).nullable(),
      }),
    )
    .optional(),
});

export const saveCourseFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        productId: z.string().uuid(),
        course,
        // Что карточка видела при загрузке: присланное боту позже не затирается.
        seen: z
          .object({
            lessons: z.array(z.string().max(64)).max(LESSONS_MAX * 2),
            tgVideos: z.array(z.string().max(200)).max(LESSONS_MAX * LESSON_VIDEOS_MAX),
          })
          .optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await moduleAdmin("manager");
    const { getCourse, saveCourse } = await import("@/core/courses/course.server");
    let next: Course = data.course;
    if (data.seen) {
      const { keepBotAdditions } = await import("@/core/courses/lesson-by-bot");
      next = keepBotAdditions(await getCourse(ctx, data.productId), next, data.seen);
    }
    await saveCourse(ctx, data.productId, next);
    return { ok: true, course: await getCourse(ctx, data.productId) };
  });

/** Варианты товара — тарифы курса: название и id. */
export const courseVariantsFn = createServerFn({ method: "GET" })
  .validator((d: unknown) => z.object({ productId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await moduleAdmin();
    const { data: rows, error } = await ctx.db
      .from("product_variants")
      .select("id, name, sort_order")
      .eq("product_id", data.productId)
      .order("sort_order")
      .order("id");
    if (error) {
      const { serverFailure } = await import("@/lib/server-failure");
      throw serverFailure(`Варианты товара не прочитаны: ${error.message}`);
    }
    return (rows ?? []).map((v) => ({ id: v.id, name: v.name }));
  });

/** Прогресс учеников курса: только чтение, видит вся команда. */
export const courseStudentsFn = createServerFn({ method: "GET" })
  .validator((d: unknown) => z.object({ productId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await moduleAdmin();
    const { courseStudents } = await import("@/core/courses/progress.server");
    return courseStudents(ctx, data.productId);
  });

/** Воронка курса по потоку: только чтение, видит вся команда (core/courses/funnel). */
export const courseFunnelFn = createServerFn({ method: "GET" })
  .validator((d: unknown) =>
    z.object({ productId: z.string().uuid(), cohortId: z.string().uuid().nullable() }).parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await moduleAdmin();
    const { courseFunnel } = await import("@/core/courses/funnel.server");
    return courseFunnel(ctx, data.productId, data.cohortId);
  });

/** Ученики шага воронки — список по клику на цифру. */
export const funnelStudentsFn = createServerFn({ method: "GET" })
  .validator((d: unknown) =>
    z
      .object({
        productId: z.string().uuid(),
        cohortId: z.string().uuid().nullable(),
        kind: z.enum(["opened", "homework", "quiz", "done", "finished"]),
        lessonNo: z.number().int().min(0).max(100),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await moduleAdmin();
    const { funnelStudents } = await import("@/core/courses/funnel.server");
    return funnelStudents(ctx, data.productId, data.cohortId, data.kind, data.lessonNo);
  });

/** Закрытый канал курса: бот магазина видит его и может приглашать учеников. */
export const checkCourseChannelFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ channel: z.string().max(40) }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await moduleAdmin("manager");
    const { checkCourseChannel } = await import("./course-channel.server");
    return checkCourseChannel(ctx, data.channel);
  });

/** Исключить ученика из закрытого канала курса (менеджер и выше). */
export const revokeStudentChannelFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ orderItemId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await moduleAdmin("manager");
    const { revokeStudentChannel } = await import("./course-channel.server");
    return revokeStudentChannel(ctx, data.orderItemId);
  });

/** «Сбросить попытки» теста ученику: лимит считается заново (менеджер и выше). */
export const resetQuizAttemptsFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ orderItemId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await moduleAdmin("manager");
    const { resetQuizAttempts } = await import("@/core/courses/lesson-quiz.server");
    return resetQuizAttempts(ctx, data.orderItemId);
  });

/** Продлить ученику доступ вручную до конца дня, с причиной (менеджер и выше). */
export const extendStudentAccessFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        orderItemId: z.string().uuid(),
        day: z.string().regex(LOCAL_DAY_RE),
        reason: z.string().max(300),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await moduleAdmin("manager");
    const { extendStudentAccess } = await import("@/core/courses/extend.server");
    return extendStudentAccess(ctx, data.orderItemId, data.day, data.reason);
  });

/** «Создать следующий поток»: копия последнего потока со сдвигом старта (менеджер и выше). */
export const createNextCohortFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z.object({ productId: z.string().uuid(), startDay: z.string().regex(LOCAL_DAY_RE) }).parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await moduleAdmin("manager");
    const { createNextCohort } = await import("@/core/courses/course.server");
    return createNextCohort(ctx, data.productId, data.startDay);
  });

/** Эфир потока: добавить или поправить (Ш1, менеджер и выше). Id задаёт форма. */
export const saveLiveFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        productId: z.string().uuid(),
        cohortId: z.string().uuid(),
        live: z.object({
          id: z.string().uuid(),
          title: z.string().max(LIVE_TITLE_MAX),
          at: z.string().regex(LOCAL_START_RE),
          link: z.string().max(LIVE_LINK_MAX).nullable(),
          recording: z.string().max(LIVE_LINK_MAX).nullable().optional(),
          durationMin: z.number().int().optional(),
        }),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await moduleAdmin("manager");
    const { saveLive } = await import("@/core/courses/lives.server");
    return saveLive(ctx, data.productId, data.cohortId, data.live);
  });

/** Удалить эфир потока (менеджер и выше). */
export const deleteLiveFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        productId: z.string().uuid(),
        cohortId: z.string().uuid(),
        liveId: z.string().uuid(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await moduleAdmin("manager");
    const { deleteLive } = await import("@/core/courses/lives.server");
    return deleteLive(ctx, data.productId, data.cohortId, data.liveId);
  });

/** Перевести ученика в другой поток (менеджер и выше). */
export const moveStudentCohortFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z.object({ orderItemId: z.string().uuid(), cohortId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await moduleAdmin("manager");
    const { moveStudent } = await import("./course-channel.server");
    return moveStudent(ctx, data.orderItemId, data.cohortId);
  });

/** Видимые боту участники закрытых каналов без действующей покупки (только чтение). */
export const channelStrangersFn = createServerFn({ method: "GET" }).handler(async () => {
  const ctx = await moduleAdmin("manager");
  const { listChannelStrangers } = await import("./course-channel.server");
  return listChannelStrangers(ctx);
});

/** Исключить постороннего из закрытого канала курса (менеджер и выше). */
export const kickChannelStrangerFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z.object({ channel: z.string().max(40), userId: z.number().int().positive() }).parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await moduleAdmin("manager");
    const { kickStranger } = await import("./course-channel.server");
    return kickStranger(ctx, data.channel, data.userId);
  });

/** «Ученики» онлайн-школы: все курсы магазина с учениками (только чтение). */
export const schoolStudentsFn = createServerFn({ method: "GET" }).handler(async () => {
  const ctx = await moduleAdmin();
  const { schoolStudents } = await import("./students.server");
  return schoolStudents(ctx);
});

/** Сводка онлайн-школы для главной админки. */
export const schoolOverviewFn = createServerFn({ method: "GET" }).handler(async () => {
  const ctx = await moduleAdmin();
  const { schoolOverview } = await import("./students.server");
  return schoolOverview(ctx);
});

/** Чеклист запуска онлайн-школы для главной админки (только чтение). */
export const schoolLaunchFn = createServerFn({ method: "GET" }).handler(async () => {
  const ctx = await moduleAdmin();
  const { schoolLaunchInput } = await import("./school-launch.server");
  const { launchSteps, launchHints } = await import("@/core/courses/launch");
  const input = await schoolLaunchInput(ctx);
  return { steps: launchSteps(input), hints: launchHints(input) };
});

/** Страница курса на витрине (core/courses/landing): прочитать. */
export const courseLandingFn = createServerFn({ method: "GET" })
  .validator((d: unknown) => z.object({ productId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await moduleAdmin();
    const { getLanding } = await import("@/core/courses/landing.server");
    return getLanding(ctx, data.productId);
  });

const LL = LANDING_LIMITS;
const landing = z.object({
  on: z.boolean(),
  theme: z.enum(LANDING_THEMES),
  accent: z.string().regex(ACCENT_RE).nullable(),
  headline: z.string().max(LL.headline),
  subtitle: z.string().max(LL.subtitle),
  // Проверка формы и занятости — в saveLanding (понятный отказ продавцу).
  short: z.string().max(64).nullable().default(null),
  order: z.array(z.enum(LANDING_BLOCKS)).max(LANDING_BLOCKS.length),
  hidden: z.array(z.enum(LANDING_BLOCKS)).max(LANDING_BLOCKS.length),
  authors: z
    .array(
      z.object({
        photo: z.string().max(512).nullable(),
        name: z.string().max(LL.authorName),
        text: z.string().max(LL.authorText),
      }),
    )
    .max(LL.authors),
  learn: z.array(z.string().max(LL.learnItem)).max(LL.learn),
  works: z.array(z.string().max(512)).max(LL.works),
  quotes: z
    .array(z.object({ name: z.string().max(LL.quoteName), text: z.string().max(LL.quoteText) }))
    .max(LL.quotes),
  faq: z.array(z.object({ q: z.string().max(LL.faqQ), a: z.string().max(LL.faqA) })).max(LL.faq),
});

/** Страница курса: сохранить (менеджер и выше). */
export const saveCourseLandingFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ productId: z.string().uuid(), landing }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await moduleAdmin("manager");
    const { saveLanding } = await import("@/core/courses/landing.server");
    return saveLanding(ctx, data.productId, data.landing);
  });

const tgVideo = z.object({
  productId: z.string().uuid(),
  lessonId: z.string().max(64),
  fileId: z.string().min(1).max(200),
});

/** «Убрать» у видео урока, присланного боту: сразу, без общей кнопки «Сохранить». */
export const removeLessonTgVideoFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => tgVideo.parse(d))
  .handler(async ({ data }) => {
    const ctx = await moduleAdmin("manager");
    const { removeLessonTgVideo } = await import("@/core/courses/lesson-by-bot.server");
    return { result: await removeLessonTgVideo(ctx, data.productId, data.lessonId, data.fileId) };
  });

/** «Прислать мне в Telegram»: посмотреть видео урока из бота. */
export const sendLessonTgVideoFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => tgVideo.parse(d))
  .handler(async ({ data }) => {
    const ctx = await moduleAdmin("manager");
    const { adminIdentity } = await import("@/app/auth/guards.server");
    const me = await adminIdentity();
    const isOwner = !!me && me.username === ctx.tenant.settings.admin?.username;
    const { sendLessonTgVideo } = await import("./course-tg-video.server");
    return sendLessonTgVideo(ctx, data.productId, data.lessonId, data.fileId, isOwner);
  });
