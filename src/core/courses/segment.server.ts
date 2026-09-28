import type { TenantContext } from "@/core/tenant/resolve.server";
import { courseTimeline } from "./cohort";
import { readSettings } from "./db.server";
import { hwKey, parseHomework } from "./homework";
import { loadRuns } from "./runs.server";

/**
 * Сегмент рассылки «ученики курса» (core/broadcasts/segments): все
 * ученики, отстающие, не сдавшие открытое задание, прошедшие курс — по
 * желанию в одном потоке. Только выданные заказы из Telegram: рассылка
 * идёт ботом.
 */
export type CourseAudience = "all" | "behind" | "homework" | "completed";

export async function courseSegmentMembers(
  ctx: TenantContext,
  productId: string,
  who: CourseAudience,
  cohortId: string | null,
  now = new Date(),
): Promise<Set<number>> {
  if (!ctx.tenant.modules.courses) return new Set();
  const runs = (await loadRuns(ctx)).filter(
    (r) =>
      r.productId === productId &&
      r.order.status === "delivered" &&
      r.order.platform === "telegram" &&
      Number(r.order.telegram_id) > 0,
  );
  const withTl = runs.map((r) => ({
    r,
    tl: courseTimeline(
      { course: r.course, run: r.run, boughtAt: r.order.created_at, variantId: r.variantId },
      ctx.timezone,
      now,
    ),
  }));
  const inCohort = withTl.filter(({ tl }) => !cohortId || tl.cohort?.id === cohortId);
  const hw =
    who === "homework" || who === "behind"
      ? await readSettings(
          ctx,
          inCohort.flatMap(({ r, tl }) =>
            tl.access
              .filter((a) => a.open && a.lesson.homework)
              .map((a) => hwKey(r.itemId, a.lesson.id)),
          ),
        )
      : new Map<string, string>();
  const out = new Set<number>();
  for (const { r, tl } of inCohort) {
    const ids = new Set(r.course.lessons.map((l) => l.id));
    const done = r.run.done.filter((id) => ids.has(id)).length;
    const open = tl.access.filter((a) => a.open);
    const statuses = open
      .filter((a) => a.lesson.homework)
      .map((a) => parseHomework(hw.get(hwKey(r.itemId, a.lesson.id)))?.status ?? null);
    const pick =
      who === "all" ||
      (who === "completed" && done >= r.course.lessons.length) ||
      (who === "homework" &&
        tl.tariff.homework &&
        statuses.some((s) => s === null || s === "revise")) ||
      (who === "behind" && !tl.expired && (open.length - done >= 2 || statuses.includes("revise")));
    if (pick) out.add(Number(r.order.telegram_id));
  }
  return out;
}
