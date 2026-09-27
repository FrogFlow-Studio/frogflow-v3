import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  DRIP_DAYS_MAX,
  DRIP_DAYS_MIN,
  LESSON_FILES_MAX,
  LESSON_LINK_MAX,
  LESSON_TEXT_MAX,
  LESSON_TITLE_MAX,
  LESSONS_MAX,
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
});

export const saveCourseFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ productId: z.string().uuid(), course }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await moduleAdmin("manager");
    const { saveCourse } = await import("@/core/courses/course.server");
    await saveCourse(ctx, data.productId, data.course);
    return { ok: true };
  });

/** Прогресс учеников курса: только чтение, видит вся команда. */
export const courseStudentsFn = createServerFn({ method: "GET" })
  .validator((d: unknown) => z.object({ productId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await moduleAdmin();
    const { courseStudents } = await import("@/core/courses/progress.server");
    return courseStudents(ctx, data.productId);
  });
