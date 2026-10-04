import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/** «Что нового»: новости платформы для продавца. Читает вся команда, кроме бухгалтера. */
const guards = () => import("@/app/auth/guards.server");

export const newsFn = createServerFn({ method: "GET" }).handler(async () => {
  const ctx = await (await guards()).requireAdmin();
  const { sellerLocale } = await import("@/core/catalog/low-stock");
  const { loadNews } = await import("@/core/news/news");
  return loadNews(ctx, await sellerLocale(ctx));
});

/** Открыли страницу — видимые новости прочитаны, бейдж в меню гаснет. */
export const newsReadFn = createServerFn({ method: "POST" }).handler(async () => {
  const ctx = await (await guards()).requireAdmin();
  const { markNewsRead } = await import("@/core/news/news");
  return { marked: await markNewsRead(ctx) };
});

/** Голос в опросе: отдать может владелец и менеджер, один раз на магазин. */
export const voteNewsFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z.object({ newsId: z.string().uuid(), option: z.number().int().min(0).max(3) }).parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await (await guards()).requireAdminRole("manager");
    const { voteNews } = await import("@/core/news/news");
    return voteNews(ctx, data.newsId, data.option);
  });
