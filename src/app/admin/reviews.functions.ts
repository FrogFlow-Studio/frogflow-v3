import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { UserError } from "@/core/i18n/user-error";
import { serverFailure } from "@/lib/server-failure";

/**
 * Отзывы покупателей (модуль review_request): список, черновик ответа от
 * ИИ-помощника (core/assistant) и отправка ответа покупателю. Смотреть может
 * вся команда, отвечать — менеджер и выше.
 */
const lang = z.enum(["ru", "kk", "en", "uz"]).optional();

export const reviewsFn = createServerFn({ method: "GET" })
  .validator((d: unknown) =>
    z
      .object({
        rating: z.number().int().min(1).max(5).optional(),
        withComment: z.boolean().optional(),
        noReply: z.boolean().optional(),
        pending: z.boolean().optional(),
        productId: z.string().min(1).max(64).optional(),
        page: z.number().int().min(1).max(10_000).optional(),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ data }) => {
    const ctx = await (
      await import("@/app/auth/guards.server")
    ).requireAdminModule("review_request");
    const { listReviewsForAdmin } = await import("@/core/reviews/admin");
    const { reviewAskDays } = await import("@/core/reviews/ask");
    return {
      ...(await listReviewsForAdmin(ctx, data)),
      askDays: reviewAskDays(ctx.tenant.settings.review_ask_days),
    };
  });

/** Через сколько дней после выдачи просить оценку (core/reviews/ask). */
export const setReviewAskDaysFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ days: z.number().int().min(1).max(30) }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await (
      await import("@/app/auth/guards.server")
    ).requireAdminModule("review_request", "manager");
    const { patchTenantSettings } = await import("@/core/tenant/resolve.server");
    await patchTenantSettings(ctx.tenant.id, { review_ask_days: data.days });
    return { ok: true };
  });

async function reviewOrFail(id: string) {
  const ctx = await (
    await import("@/app/auth/guards.server")
  ).requireAdminModule("review_request", "manager");
  const { getReviewForAdmin } = await import("@/core/reviews/admin");
  const review = await getReviewForAdmin(ctx, id);
  if (!review) throw new UserError("err.review.notFound", "Отзыв не найден.");
  return { ctx, review };
}

export const assistReviewReplyFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ id: z.string().uuid(), lang }).parse(d))
  .handler(async ({ data }) => {
    const { ctx, review } = await reviewOrFail(data.id);
    const { assistText } = await import("@/core/assistant/assistant.server");
    const text = await assistText(ctx, {
      task: "review",
      lang: data.lang ?? ctx.tenant.settings.default_locale ?? "ru",
      product: { name: review.productName ?? "товар" },
      review: { rating: review.rating, comment: review.comment },
    });
    return { text };
  });

export const replyToReviewFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        text: z.string().trim().min(1).max(1000),
        // Куда ответ: покупателю личным сообщением и/или публично на витрине.
        notify: z.boolean().default(true),
        publish: z.boolean().default(false),
      })
      .refine((v) => v.notify || v.publish)
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { ctx, review } = await reviewOrFail(data.id);
    if (data.notify) {
      const { sendReviewReply } = await import("./reviews.server");
      if (!(await sendReviewReply(ctx, review, data.text)))
        throw new UserError(
          "err.review.notDelivered",
          "Ответ не доставлен: покупатель недоступен в своём канале (заблокировал бота или диалог закрыт).",
        );
    }
    const { markReviewReplied } = await import("@/core/reviews/photos.server");
    const saved = await markReviewReplied(ctx, review.id, data.publish ? data.text : null).catch(
      () => false,
    );
    // Личное сообщение уже ушло и не отменяется; а публичный ответ без записи не виден.
    if (!saved && data.publish)
      throw new UserError(
        "err.review.publicNotSaved",
        "Ответ не сохранён для витрины. Если он уже ушёл покупателю, повторите только «Показать на витрине».",
      );
    return { ok: true };
  });

/** «Убрать ответ с витрины»: личное сообщение покупателю не отзывается. */
export const clearPublicReplyFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { ctx } = await reviewOrFail(data.id);
    const { clearPublicReply } = await import("@/core/reviews/photos.server");
    if (!(await clearPublicReply(ctx, data.id))) throw serverFailure("Отзывы: ответ не убран");
    return { ok: true };
  });

/** Решение для витрины: показать отзыв покупателям или скрыть. */
export const setReviewStatusFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z.object({ id: z.string().uuid(), status: z.enum(["approved", "hidden"]) }).parse(d),
  )
  .handler(async ({ data }) => {
    const { ctx } = await reviewOrFail(data.id);
    const { setReviewStatus } = await import("@/core/reviews/photos.server");
    if (!(await setReviewStatus(ctx, data.id, data.status)))
      throw serverFailure("Отзывы: решение не сохранено");
    return { ok: true };
  });

/** «Одобрить все старые»: отзывы, оставленные до одобрения продавцом, — на витрину. */
export const approveLegacyReviewsFn = createServerFn({ method: "POST" }).handler(async () => {
  const ctx = await (
    await import("@/app/auth/guards.server")
  ).requireAdminModule("review_request", "manager");
  const { approveLegacyReviews } = await import("@/core/reviews/photos.server");
  return await approveLegacyReviews(ctx);
});
