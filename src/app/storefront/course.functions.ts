import { notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { SHOP_SLUG_RE } from "@/core/tenant/slug";

/**
 * Страница курса (модуль courses): покупатель приходит по ссылке из
 * сообщения о выдаче, без входа. Правило 6: магазин должен быть на v2 и с
 * готовым модулем (storefrontOpen), иначе 404.
 */
const input = z.object({
  slug: z.string().regex(SHOP_SLUG_RE),
  itemId: z.string().uuid(),
  k: z.string().min(1).max(64),
});

async function purchase(d: z.infer<typeof input>) {
  const { resolveTenant, tenantContext } = await import("@/core/tenant/resolve.server");
  const { storefrontOpen } = await import("@/core/storefront/access");
  const t = await resolveTenant({ by: "slug", value: d.slug });
  if (!t || !storefrontOpen(t, "course")) throw notFound();
  const ctx = tenantContext(t);
  const { env } = await import("@/config/env");
  const { openCourse } = await import("./course.server");
  const p = await openCourse(ctx, env().SECRETS_KEY, d.itemId, d.k);
  if (!p) throw notFound();
  return { ctx, p };
}

export const courseViewFn = createServerFn({ method: "GET" })
  .validator((d: unknown) => input.parse(d))
  .handler(async ({ data }) => {
    const { ctx, p } = await purchase(data);
    const { courseView } = await import("./course.server");
    const { signedFileUrl } = await import("@/core/orders/orders");
    return courseView(ctx, p, (path, name) => signedFileUrl(path, 24 * 3600, name ?? undefined));
  });

export const markLessonFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    input.extend({ lessonId: z.string().uuid(), done: z.boolean() }).parse(d),
  )
  .handler(async ({ data }) => {
    const { ctx, p } = await purchase(data);
    const { setLessonDone } = await import("./course.server");
    return { done: await setLessonDone(ctx, p, data.lessonId, data.done) };
  });
