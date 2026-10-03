import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * Домашние задания (модуль «Курсы», ниша «Онлайн-школа»): очередь видит вся
 * команда, проверяет — менеджер и владелец.
 */
const moduleAdmin = async (min?: "manager") =>
  (await import("@/app/auth/guards.server")).requireAdminModule("courses", min);

export const homeworkQueueFn = createServerFn({ method: "GET" }).handler(async () => {
  const ctx = await moduleAdmin();
  const { homeworkQueue, cohortChoices } = await import("./homework.server");
  const { parseCurators } = await import("@/core/courses/curators");
  return {
    items: await homeworkQueue(ctx),
    curators: parseCurators(ctx.tenant.settings.curators),
    cohorts: await cohortChoices(ctx),
  };
});

export const reviewHomeworkFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        orderItemId: z.string().uuid(),
        lessonId: z.string().uuid(),
        rev: z.number().int().min(0),
        status: z.enum(["accepted", "revise"]),
        text: z.string().max(4000),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await moduleAdmin("manager");
    const { adminActor } = await import("@/app/auth/guards.server");
    const by = (await adminActor()).replace(/^admin:/, "");
    const { reviewAndNotify } = await import("./homework.server");
    return reviewAndNotify(ctx, { ...data, by });
  });

/** Кураторы школы: список, режим назначения (менеджер и владелец). */
export const saveCuratorsFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        mode: z.enum(["rotate", "cohort"]),
        items: z
          .array(
            z.object({
              id: z.string().uuid().optional(),
              name: z.string().trim().min(1).max(60),
              telegramId: z.number().int().positive(),
              username: z.string().max(40).optional(),
              cohorts: z.array(z.string().uuid()).max(50).optional(),
            }),
          )
          .max(20),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await moduleAdmin("manager");
    const { saveCurators } = await import("./homework.server");
    await saveCurators(ctx, data);
  });
