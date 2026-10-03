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
  const { takeCourse } = await import("@/core/storefront/rate-limit");
  if (!(await takeCourse(ctx, d.itemId))) {
    const { shownError } = await import("@/lib/shown-error");
    const { storefrontT } = await import("@/app/i18n/storefront");
    throw shownError(storefrontT(t.settings.default_locale ?? "ru")("error.tooManyRequests"));
  }
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
    return setLessonDone(ctx, p, data.lessonId, data.done);
  });

/** Файл ответа на домашнее задание: до 3 МБ в base64 (тело запроса Vercel ~4,5 МБ). */
export const uploadHomeworkFileFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    input
      .extend({
        name: z.string().max(200).nullable(),
        data: z.string().max(Math.ceil((3 * 1024 * 1024 * 4) / 3) + 8),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { ctx, p } = await purchase(data);
    const { uploadHomeworkFile } = await import("@/core/courses/homework.server");
    const r = await uploadHomeworkFile(
      ctx,
      p.orderItemId,
      new Uint8Array(Buffer.from(data.data, "base64")),
      data.name,
    );
    if (!r.ok) throw await homeworkError(ctx, r.reason === "tooLarge" ? "tooLarge" : "badFile");
    return r.file;
  });

export const submitHomeworkFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    input
      .extend({
        lessonId: z.string().uuid(),
        text: z.string().max(4000),
        files: z
          .array(
            z.object({
              path: z.string().min(1).max(300),
              name: z.string().max(200).nullable(),
              mime: z.string().max(100),
            }),
          )
          .max(5),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { ctx, p } = await purchase(data);
    const { submitHomework } = await import("@/core/courses/homework.server");
    const r = await submitHomework(ctx, p, data.lessonId, { text: data.text, files: data.files });
    if (!r.ok)
      throw await homeworkError(
        ctx,
        r.reason === "empty"
          ? "empty"
          : r.reason === "accepted"
            ? "accepted"
            : r.reason === "closed" || r.reason === "noHomework"
              ? "closed"
              : r.reason === "notInTariff"
                ? "notInTariff"
                : "failed",
      );
    // Преподавателю — сразу, как вопрос покупателя (матрица уведомлений продавца).
    const { notifyHomework } = await import("@/channels/telegram/course-notify");
    await notifyHomework(ctx, r.homework).catch(() => 0);
    return { status: r.homework.status };
  });

/** Личная ссылка в закрытый канал курса или чат потока (core/courses/channel.server). */
async function inviteLink(d: z.infer<typeof input>, chat: boolean) {
  const { ctx, p } = await purchase(d);
  const { shownError } = await import("@/lib/shown-error");
  const { storefrontT } = await import("@/app/i18n/storefront");
  const t = storefrontT(ctx.tenant.settings.default_locale ?? "ru");
  let token: string;
  try {
    token = ctx.secrets.telegramToken();
  } catch {
    throw shownError(t("course.channel.failed"));
  }
  const { env } = await import("@/config/env");
  const { telegramApi } = await import("@/channels/telegram/api");
  const { telegramChannelInviter } = await import("@/channels/telegram/courses");
  const { courseChannelInvite, courseChatInvite } = await import("@/core/courses/channel.server");
  const access = telegramChannelInviter(telegramApi(token, env().TELEGRAM_API_BASE));
  const r = chat
    ? await courseChatInvite(ctx, p, access)
    : await courseChannelInvite(ctx, p, access);
  if (r.ok) return { link: r.link };
  throw shownError(
    t(
      r.reason === "busy"
        ? "course.channel.busy"
        : r.reason === "alreadyMember"
          ? "course.channel.already"
          : "course.channel.failed",
    ),
  );
}

export const courseChannelInviteFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => input.parse(d))
  .handler(({ data }) => inviteLink(data, false));

/** Личная ссылка в групповой чат потока ученика. */
export const courseChatInviteFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => input.parse(d))
  .handler(({ data }) => inviteLink(data, true));

async function homeworkError(
  ctx: import("@/core/tenant/resolve.server").TenantContext,
  kind: "empty" | "accepted" | "closed" | "notInTariff" | "tooLarge" | "badFile" | "failed",
) {
  const { shownError } = await import("@/lib/shown-error");
  const { storefrontT } = await import("@/app/i18n/storefront");
  return shownError(
    storefrontT(ctx.tenant.settings.default_locale ?? "ru")(`course.hw.err.${kind}`),
  );
}
