import { createServerFn } from "@tanstack/react-start";
import { notFound } from "@tanstack/react-router";
import { z } from "zod";
import { SHOP_SLUG_RE } from "@/core/tenant/slug";

/**
 * Отзывы на странице товара (core/reviews/photos): только одобренные
 * продавцом, постранично, с фильтрами «с фото» и по оценке; только витрина клиента v2 с открытым каталогом. Отдельно от
 * storefront.functions — код оформления заказа не трогаем.
 */
export const storeReviewsFn = createServerFn({ method: "GET" })
  .validator((d: unknown) =>
    z
      .object({
        slug: z.string().regex(SHOP_SLUG_RE),
        id: z.string().uuid(),
        rating: z.number().int().min(1).max(5).optional(),
        withPhoto: z.boolean().optional(),
        offset: z.number().int().min(0).max(5000).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { resolveTenant, tenantContext } = await import("@/core/tenant/resolve.server");
    const { storefrontOpen } = await import("@/core/storefront/access");
    const t = await resolveTenant({ by: "slug", value: data.slug });
    if (!t || !storefrontOpen(t, "catalog")) throw notFound();
    const { approvedReviewsPage } = await import("@/core/reviews/photos.server");
    return approvedReviewsPage(tenantContext(t), data.id, {
      rating: data.rating,
      withPhoto: data.withPhoto,
      offset: data.offset,
    });
  });

/** Магазин, где вход через Telegram и каталог открыты, или null. Клиент прежней платформы — null. */
async function reviewCtx(slug: string) {
  const { resolveTenant, tenantContext } = await import("@/core/tenant/resolve.server");
  const { storefrontOpen } = await import("@/core/storefront/access");
  const t = await resolveTenant({ by: "slug", value: slug });
  if (!t || !storefrontOpen(t, "catalog") || !storefrontOpen(t, "web_checkout")) return null;
  const ctx = tenantContext(t);
  const { tgLoginAvailable } = await import("./tg-login.server");
  return (await tgLoginAvailable(ctx)) ? ctx : null;
}

/**
 * Что покупатель может сделать с отзывами этого товара: вошёл ли он, есть ли у него
 * выданный заказ с этим товаром, что уже написал. Не вошёл — `loginAvailable` говорит,
 * стоит ли звать войти.
 */
export const webReviewStateFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z.object({ slug: z.string().regex(SHOP_SLUG_RE), productId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await reviewCtx(data.slug);
    if (!ctx) return { loginAvailable: false as const };
    const { buyerTelegramId } = await import("./tg-login.server");
    const tgId = await buyerTelegramId(ctx);
    if (tgId === null) return { loginAvailable: true as const, loggedIn: false as const };
    const { webReviewState } = await import("@/core/reviews/web-review");
    return {
      loginAvailable: true as const,
      loggedIn: true as const,
      ...(await webReviewState(ctx, tgId, data.productId)),
    };
  });

/** Фото к отзыву: тело запроса ограничено (~4,5 МБ), поэтому страница уменьшает снимки до отправки. */
const REVIEW_UPLOAD_MAX_CHARS = 1_400_000;

export const webReviewFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        slug: z.string().regex(SHOP_SLUG_RE),
        productId: z.string().uuid(),
        rating: z.number().int().min(1).max(5),
        comment: z.string().max(2000).default(""),
        photos: z.array(z.string().max(REVIEW_UPLOAD_MAX_CHARS)).max(3).default([]),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await reviewCtx(data.slug);
    if (!ctx) throw notFound();
    const { storefrontT } = await import("@/app/i18n/storefront");
    const t = storefrontT(ctx.tenant.settings.default_locale ?? "ru");
    const { shownError } = await import("@/lib/shown-error");
    const { buyerTelegramId } = await import("./tg-login.server");
    const tgId = await buyerTelegramId(ctx);
    if (tgId === null) throw shownError(t("review.error.login"));
    const { takeWeb } = await import("@/core/storefront/checkout-guard");
    if (!(await takeWeb(ctx, "review", String(tgId)))) throw shownError(t("error.tooManyRequests"));
    const { submitWebReview } = await import("@/core/reviews/web-review");
    const r = await submitWebReview(ctx, tgId, data.productId, {
      rating: data.rating,
      comment: data.comment,
      photos: data.photos.map((b) => new Uint8Array(Buffer.from(b, "base64"))),
    });
    if (!r.ok)
      throw shownError(
        t(r.reason === "no_purchase" ? "review.error.purchase" : "review.error.failed"),
      );
    return { photosAdded: r.photosAdded, photosRejected: r.photosRejected.length };
  });
