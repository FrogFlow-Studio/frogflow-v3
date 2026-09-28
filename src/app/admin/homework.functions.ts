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
  const { homeworkQueue } = await import("./homework.server");
  return { items: await homeworkQueue(ctx) };
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
