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
});

const course = z.object({
  schedule: z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("all") }),
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
