import { createServerFn } from "@tanstack/react-start";
import { notFound } from "@tanstack/react-router";
import { z } from "zod";
import { SHOP_SLUG_RE } from "@/core/tenant/slug";
import { QUIZ_MAX_OPTIONS, QUIZ_MAX_QUESTIONS } from "@/core/quiz/quiz";
import { shownError } from "@/lib/shown-error";

/**
 * Квиз-подбор на витрине (модуль quiz). Вопросы отдаём без тегов: подсчёт
 * ответов и результат — в core/quiz, те же, что у Telegram и Instagram/WhatsApp.
 * Только клиенты v2 с открытым каталогом и включённым модулем, иначе 404.
 */
const slug = z.string().regex(SHOP_SLUG_RE);

async function quizCtx(s: string) {
  const { resolveTenant, tenantContext } = await import("@/core/tenant/resolve.server");
  const { storefrontOpen } = await import("@/core/storefront/access");
  const t = await resolveTenant({ by: "slug", value: s });
  if (!t || !storefrontOpen(t, "quiz")) throw notFound();
  return tenantContext(t);
}

export const storeQuizFn = createServerFn({ method: "GET" })
  .validator((d: unknown) => z.object({ slug }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await quizCtx(data.slug);
    const { loadQuiz } = await import("@/core/quiz/quiz");
    const quiz = await loadQuiz(ctx);
    return {
      intro: quiz.intro,
      questions: quiz.questions.map((q) => ({
        text: q.text,
        options: q.options.map((o) => ({ label: o.label })),
      })),
    };
  });

/** Номера выбранных вариантов по порядку вопросов → до трёх подходящих товаров. */
export const storeQuizResultFn = createServerFn({ method: "GET" })
  .validator((d: unknown) =>
    z
      .object({
        slug,
        answers: z
          .array(
            z
              .number()
              .int()
              .min(0)
              .max(QUIZ_MAX_OPTIONS - 1),
          )
          .max(QUIZ_MAX_QUESTIONS),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await quizCtx(data.slug);
    const { loadQuiz, tagsForAnswers, quizResult } = await import("@/core/quiz/quiz");
    const tags = tagsForAnswers(await loadQuiz(ctx), data.answers);
    if (!tags) {
      const { storefrontT } = await import("@/app/i18n/storefront");
      throw shownError(storefrontT(ctx.tenant.settings.default_locale ?? "ru")("quiz.notReady"));
    }
    const { storeProductsByIds } = await import("@/core/storefront/catalog");
    const found = await quizResult(ctx, tags);
    return storeProductsByIds(
      ctx,
      found.map((p) => p.id),
    );
  });
