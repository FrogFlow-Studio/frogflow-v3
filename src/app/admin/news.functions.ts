import { createServerFn } from "@tanstack/react-start";

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
