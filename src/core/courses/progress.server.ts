import { displayNo } from "@/core/orders/pure";
import { getSetting, getSettings } from "@/core/settings/settings";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { lessonsAccess } from "./access";
import { courseKey, parseCourse } from "./course";
import { parseRun, runKey } from "./run.server";

/**
 * Прогресс учеников курса для продавца: кто купил (выданный заказ), начал
 * ли, сколько уроков открыто и сколько отмечено пройденными. Только чтение.
 */
export type CourseStudent = {
  orderNo: number;
  buyer: string | null;
  boughtAt: string;
  /** null — покупатель ещё не открывал курс. */
  startedAt: string | null;
  open: number;
  done: number;
};

export const STUDENTS_MAX = 200;

export async function courseStudents(
  ctx: TenantContext,
  productId: string,
  now = new Date(),
): Promise<{ total: number; students: CourseStudent[] }> {
  const course = parseCourse(await getSetting(ctx, courseKey(productId)));
  const total = course.lessons.length;
  const { data: items } = await ctx.db
    .from("order_items")
    .select("id, order_id")
    .eq("product_id", productId)
    .limit(STUDENTS_MAX * 2);
  if (!items?.length) return { total, students: [] };
  const { data: orders } = await ctx.db
    .from("orders")
    .select("id, order_no, display_no, display_name, created_at, status")
    .in("id", [...new Set(items.map((i) => i.order_id))])
    .eq("status", "delivered");
  const orderById = new Map((orders ?? []).map((o) => [o.id, o]));
  const bought = items.filter((i) => orderById.has(i.order_id)).slice(0, STUDENTS_MAX);
  const runs = bought.length
    ? await getSettings(
        ctx,
        bought.map((i) => runKey(i.id)),
      )
    : {};
  const ids = new Set(course.lessons.map((l) => l.id));
  const students = bought.map((i): CourseStudent => {
    const o = orderById.get(i.order_id)!;
    const run = parseRun(runs[runKey(i.id)]);
    return {
      orderNo: displayNo(o),
      buyer: o.display_name ?? null,
      boughtAt: o.created_at,
      startedAt: run?.startedAt ?? null,
      open: run
        ? lessonsAccess(course, run.startedAt, now.getTime()).filter((a) => a.open).length
        : 0,
      // Отметки удалённых уроков не считаем.
      done: run ? run.done.filter((id) => ids.has(id)).length : 0,
    };
  });
  students.sort((a, b) => b.boughtAt.localeCompare(a.boughtAt));
  return { total, students };
}
