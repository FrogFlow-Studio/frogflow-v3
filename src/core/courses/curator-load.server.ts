import type { TenantContext } from "@/core/tenant/resolve.server";
import { curatorsOf } from "./curators.server";
import { parseCurators } from "./curators";
import { listHomework } from "./homework.server";

/**
 * Нагрузка кураторов: сколько работ ждёт проверки у каждого, сколько проверено
 * за 7 дней и самая давняя непроверенная. Работа принадлежит куратору,
 * закреплённому за учеником (core/courses/curators.server); работы без
 * куратора — отдельной строкой. Только чтение, весь список работ постранично
 * (`listHomework`), без обрезки.
 */
export type CuratorLoad = {
  /** null — работы без закреплённого куратора. */
  id: string | null;
  name: string;
  waiting: number;
  reviewed7d: number;
  /** Самая давняя непроверенная: когда сдана и чья. */
  oldest: { at: string; student: string; course: string; lessonNo: number } | null;
};

const WEEK = 7 * 86_400_000;

export async function curatorLoad(ctx: TenantContext, now = new Date()): Promise<CuratorLoad[]> {
  const cfg = parseCurators(ctx.tenant.settings.curators);
  if (cfg.items.length === 0) return [];
  const list = await listHomework(ctx);
  const assigned = await curatorsOf(ctx, [...new Set(list.map((h) => h.orderItemId))]);
  const rows = new Map<string | null, CuratorLoad>(
    cfg.items.map((c) => [
      c.id,
      { id: c.id, name: c.name, waiting: 0, reviewed7d: 0, oldest: null },
    ]),
  );
  rows.set(null, { id: null, name: "", waiting: 0, reviewed7d: 0, oldest: null });
  const since = now.getTime() - WEEK;
  for (const h of list) {
    const row = rows.get(assigned.get(h.orderItemId)?.id ?? null)!;
    if (h.status === "submitted") {
      row.waiting++;
      if (!row.oldest || h.updatedAt < row.oldest.at)
        row.oldest = {
          at: h.updatedAt,
          student: h.student,
          course: h.course,
          lessonNo: h.lessonNo,
        };
    } else if (h.feedback && Date.parse(h.feedback.at) >= since) row.reviewed7d++;
  }
  const unassigned = rows.get(null)!;
  const out = cfg.items.map((c) => rows.get(c.id)!);
  // Строка «без куратора» — только если там что-то есть.
  return unassigned.waiting || unassigned.reviewed7d ? [...out, unassigned] : out;
}
