import { env } from "@/config/env";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { UserError } from "@/core/i18n/user-error";
import { isTenantStorageKey } from "@/core/storage/keys";
import { listHomework, reviewHomework } from "@/core/courses/homework.server";
import type { Homework } from "@/core/courses/homework";
import { courseToken, courseUrl } from "@/core/courses/link";
import { storefrontBase } from "@/core/tenant/custom-domain";

/**
 * «Домашние задания» в админке (ниша «Онлайн-школа»): очередь сдач,
 * проверка с отзывом и сообщение ученику в его канале.
 */
export type HomeworkRow = Omit<Homework, "attempts"> & {
  attempts: Array<{
    at: string;
    text: string;
    files: Array<{ name: string; url: string; image: boolean }>;
  }>;
};

/** Сдачи с подписанными ссылками на файлы: последние 3 попытки, ссылки на сутки. */
export async function homeworkQueue(ctx: TenantContext, limit = 200): Promise<HomeworkRow[]> {
  const { signedFileUrl } = await import("@/core/orders/orders");
  const list = (await listHomework(ctx)).slice(0, limit);
  const out: HomeworkRow[] = [];
  for (const hw of list) {
    const attempts: HomeworkRow["attempts"] = [];
    for (const a of hw.attempts.slice(-3)) {
      const files: HomeworkRow["attempts"][number]["files"] = [];
      for (const f of a.files) {
        if (!isTenantStorageKey(ctx.tenant.id, f.path)) continue;
        const url = await signedFileUrl(f.path, 24 * 3600, f.name ?? undefined);
        if (url)
          files.push({
            name: f.name ?? f.path.split("/").pop() ?? "",
            url,
            image: f.mime.startsWith("image/") && f.mime !== "image/heic",
          });
      }
      attempts.push({ at: a.at, text: a.text, files });
    }
    out.push({ ...hw, attempts });
  }
  return out;
}

export async function reviewAndNotify(
  ctx: TenantContext,
  input: {
    orderItemId: string;
    lessonId: string;
    rev: number;
    status: "accepted" | "revise";
    text: string;
    by: string;
  },
): Promise<{ status: Homework["status"]; notified: boolean }> {
  const r = await reviewHomework(ctx, input.orderItemId, input.lessonId, input);
  if (!r.ok)
    throw r.reason === "emptyRevise"
      ? new UserError(
          "err.homework.emptyRevise",
          "Напишите, что исправить: без комментария ученик не поймёт, что не так.",
        )
      : r.reason === "stale"
        ? new UserError(
            "err.homework.stale",
            "Ученик прислал новую версию, пока вы смотрели прежнюю. Обновите страницу.",
          )
        : new UserError("err.homework.notWaiting", "Эта работа уже проверена.");
  const hw = r.homework;
  let notified = false;
  if (r.notify) {
    const { getOrder } = await import("@/core/orders/orders");
    const order = await getOrder(ctx, r.notify.orderId);
    if (order) {
      const { storefrontT } = await import("@/app/i18n/storefront");
      const t = storefrontT(ctx.tenant.settings.default_locale ?? "ru");
      const link = ctx.tenant.settings.slug
        ? courseUrl(
            storefrontBase(ctx.tenant, ctx.appUrl),
            hw.orderItemId,
            courseToken(env().SECRETS_KEY, ctx.tenant.id, hw.orderItemId),
          )
        : null;
      const text = [
        t(hw.status === "accepted" ? "course.hw.notify.accepted" : "course.hw.notify.revise", {
          course: hw.course,
          no: hw.lessonNo,
        }),
        hw.feedback?.text ?? "",
        link ? t("course.hw.notify.open", { url: link }) : "",
      ]
        .filter(Boolean)
        .join("\n\n");
      const { notifyCustomer } = await import("./admin.server");
      notified = await notifyCustomer(ctx, order, text, { email: true }).catch(() => false);
    }
  }
  return { status: hw.status, notified };
}
