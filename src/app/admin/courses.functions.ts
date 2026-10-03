import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  DRIP_DAYS_MAX,
  DRIP_DAYS_MIN,
  HOMEWORK_TASK_MAX,
  LESSON_FILES_MAX,
  LESSON_LINK_MAX,
  LESSON_TEXT_MAX,
  LESSON_TITLE_MAX,
  LESSONS_MAX,
  HOMEWORK_DAYS_MAX,
  ACCESS_DAYS_MAX,
  COHORT_TITLE_MAX,
  COHORTS_MAX,
  LOCAL_DAY_RE,
  LOCAL_START_RE,
} from "@/core/courses/course";
import {
  QUIZ_ATTEMPTS_MAX,
  QUIZ_OPTION_MAX,
  QUIZ_OPTIONS_MAX,
  QUIZ_PAUSE_MAX,
  QUIZ_QUESTIONS_MAX,
  QUIZ_TEXT_MAX,
} from "@/core/courses/lesson-quiz";

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
  .validator((d: unknown) => z.object({ productId: z.string().uuid(), course }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await moduleAdmin("manager");
    const { saveCourse } = await import("@/core/courses/course.server");
    await saveCourse(ctx, data.productId, data.course);
    return { ok: true };
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
        kind: z.enum(["opened", "homework", "done", "finished"]),
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
  const { launchSteps } = await import("@/core/courses/launch");
  return launchSteps(await schoolLaunchInput(ctx));
});
