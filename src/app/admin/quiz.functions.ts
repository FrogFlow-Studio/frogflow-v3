import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/** Квиз-подбор (модуль quiz): вопросы, варианты, теги; проверка подбора. */
const moduleAdmin = async (min?: "manager") =>
  (await import("@/app/auth/guards.server")).requireAdminModule("quiz", min);

export const quizFn = createServerFn({ method: "GET" }).handler(async () => {
  const ctx = await moduleAdmin();
  const { loadQuiz } = await import("@/core/quiz/quiz");
  return loadQuiz(ctx);
});

const quizInput = z.object({
  intro: z.string().max(500),
  questions: z
    .array(
      z.object({
        text: z.string().min(1).max(300),
        options: z
          .array(
            z.object({
              label: z.string().min(1).max(40),
              tags: z.array(z.string().max(40)).max(10),
            }),
          )
          .min(2)
          .max(6),
      }),
    )
    .max(5),
});

export const saveQuizFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => quizInput.parse(d))
  .handler(async ({ data }) => {
    const ctx = await moduleAdmin("manager");
    const { parseQuiz, saveQuiz } = await import("@/core/quiz/quiz");
    await saveQuiz(ctx, parseQuiz(JSON.stringify(data)));
    return { ok: true };
  });

/** Что покупатель увидит при выбранных вариантах — проверить теги до запуска. */
export const previewQuizFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ tags: z.array(z.string().max(40)).max(60) }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await moduleAdmin();
    const { quizResult } = await import("@/core/quiz/quiz");
    return (await quizResult(ctx, data.tags)).map((p) => ({ id: p.id, name: p.name }));
  });
