import { env } from "@/config/env";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { UserError } from "@/core/i18n/user-error";
import { isTenantStorageKey } from "@/core/storage/keys";
import { curatorsOf } from "@/core/courses/curators.server";
import { parseCurators, CURATORS_MAX, CURATOR_COHORTS_MAX } from "@/core/courses/curators";
import type { CuratorSetting } from "@/core/tenant/types";
import { listHomework, reviewHomework } from "@/core/courses/homework.server";
import type { Homework } from "@/core/courses/homework";
import { courseToken, courseUrl } from "@/core/courses/link";
import { storefrontBase } from "@/core/tenant/custom-domain";

/**
 * «Домашние задания» в админке (ниша «Онлайн-школа»): очередь сдач,
 * проверка с отзывом и сообщение ученику в его канале.
 */
export type HomeworkRow = Omit<Homework, "attempts"> & {
  /** Назначенный куратор; null — кураторов нет или работа ещё не назначена. */
  curator: { id: string; name: string; username: string | null } | null;
  attempts: Array<{
    at: string;
    text: string;
    files: Array<{ name: string; url: string; image: boolean; media?: "audio" | "video" }>;
  }>;
};

/** Сдачи с подписанными ссылками на файлы: последние 3 попытки, ссылки на сутки. */
export async function homeworkQueue(ctx: TenantContext, limit = 200): Promise<HomeworkRow[]> {
  const { signedFileUrl } = await import("@/core/orders/orders");
  const list = (await listHomework(ctx)).slice(0, limit);
  const assigned = await curatorsOf(ctx, [...new Set(list.map((h) => h.orderItemId))]);
  const out: HomeworkRow[] = [];
  for (const hw of list) {
    const attempts: HomeworkRow["attempts"] = [];
    for (const a of hw.attempts.slice(-3)) {
      const files: HomeworkRow["attempts"][number]["files"] = [];
      for (const f of a.files) {
        if (!isTenantStorageKey(ctx.tenant.id, f.path)) continue;
        // Для аудио и видео ссылка без имени: с именем она «скачать», а не «играть».
        const media = f.mime.startsWith("audio/")
          ? "audio"
          : f.mime.startsWith("video/")
            ? "video"
            : null;
        const url = await signedFileUrl(
          f.path,
          24 * 3600,
          media ? undefined : (f.name ?? undefined),
        );
        if (url)
          files.push({
            name: f.name ?? f.path.split("/").pop() ?? "",
            url,
            image: f.mime.startsWith("image/") && f.mime !== "image/heic",
            ...(media ? { media } : {}),
          });
      }
      attempts.push({ at: a.at, text: a.text, files });
    }
    const c = assigned.get(hw.orderItemId);
    out.push({
      ...hw,
      attempts,
      curator: c ? { id: c.id, name: c.name, username: c.username ?? null } : null,
    });
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
      // Принята последняя работа — курс окончен: сертификат выдаётся здесь же.
      const certUrl = hw.status === "accepted" ? await certificateLink(ctx, hw.orderItemId) : null;
      const text = [
        t(hw.status === "accepted" ? "course.hw.notify.accepted" : "course.hw.notify.revise", {
          course: hw.course,
          no: hw.lessonNo,
        }),
        hw.feedback?.text ?? "",
        link ? t("course.hw.notify.open", { url: link }) : "",
        certUrl ? t("course.cert.ready", { course: hw.course, url: certUrl }) : "",
      ]
        .filter(Boolean)
        .join("\n\n");
      const { notifyCustomer } = await import("./admin.server");
      notified = await notifyCustomer(ctx, order, text, { email: true }).catch(() => false);
    }
  }
  return { status: hw.status, notified };
}

/** Потоки всех курсов магазина — чтобы закрепить за куратором (режим «по потокам»). */
export async function cohortChoices(
  ctx: TenantContext,
): Promise<Array<{ id: string; title: string; course: string }>> {
  const { courseProducts } = await import("./students.server");
  const { getSetting } = await import("@/core/settings/settings");
  const { courseKey, parseCourse } = await import("@/core/courses/course");
  const out: Array<{ id: string; title: string; course: string }> = [];
  for (const p of await courseProducts(ctx)) {
    const c = parseCourse(await getSetting(ctx, courseKey(p.id)));
    for (const k of c.cohorts ?? []) out.push({ id: k.id, title: k.title, course: p.name });
  }
  return out;
}

export type CuratorsInput = {
  mode: "rotate" | "cohort";
  items: Array<{
    id?: string;
    name: string;
    telegramId: number;
    username?: string;
    cohorts?: string[];
  }>;
};

/**
 * Сохранить кураторов в bots.settings (patchTenantSettings: остальные ключи
 * клиента не затираются). Id уже известных кураторов сохраняются — за ними
 * закреплены ученики; новым выдаётся свой.
 */
export async function saveCurators(ctx: TenantContext, input: CuratorsInput): Promise<void> {
  const known = new Set(parseCurators(ctx.tenant.settings.curators).items.map((c) => c.id));
  const items: CuratorSetting[] = input.items.slice(0, CURATORS_MAX).map((c) => ({
    id: c.id && known.has(c.id) ? c.id : crypto.randomUUID(),
    name: c.name.trim(),
    telegram_id: c.telegramId,
    ...(c.username?.trim() ? { username: c.username.trim().toLowerCase() } : {}),
    ...(c.cohorts?.length ? { cohorts: c.cohorts.slice(0, CURATOR_COHORTS_MAX) } : {}),
  }));
  if (new Set(items.map((c) => c.telegram_id)).size !== items.length)
    throw new UserError(
      "err.curators.duplicate",
      "У двух кураторов один и тот же Telegram: уберите повтор.",
    );
  const { patchTenantSettings } = await import("@/core/tenant/resolve.server");
  await patchTenantSettings(ctx.tenant.id, { curators: { mode: input.mode, items } });
}

/** Выдать сертификат, если курс окончен; ссылка на PDF — только когда он выдан именно сейчас. */
async function certificateLink(ctx: TenantContext, orderItemId: string): Promise<string | null> {
  try {
    const { coursePurchase } = await import("@/core/courses/run.server");
    const { issueCertificate } = await import("@/core/courses/certificate.server");
    const p = await coursePurchase(ctx, orderItemId);
    const r = p ? await issueCertificate(ctx, p) : null;
    if (!r?.created || !ctx.tenant.settings.slug) return null;
    return `${storefrontBase(ctx.tenant, ctx.appUrl)}/cert/${r.certificate.code}/pdf`;
  } catch {
    return null;
  }
}
