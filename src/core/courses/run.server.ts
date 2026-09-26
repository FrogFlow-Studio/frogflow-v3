import type { TenantContext } from "@/core/tenant/resolve.server";
import { getSetting, trySetSetting } from "@/core/settings/settings";
import { lessonsAccess } from "./access";
import { courseKey, parseCourse, type Course } from "./course";

/**
 * Прохождение курса одной покупкой (позицией заказа): когда начато и какие
 * уроки пройдены. Схему не меняем — JSON в `app_settings.course_run_<id позиции>`.
 * Ключ по позиции, а не по покупателю: у покупателей из Instagram и WhatsApp
 * нет telegram_id, а позиция заказа есть в любом канале.
 */
export const RUN_KEY_PREFIX = "course_run_";
export const runKey = (orderItemId: string) => `${RUN_KEY_PREFIX}${orderItemId}`;

export type CourseRun = { startedAt: string; done: string[] };

export function parseRun(raw: string | null | undefined): CourseRun | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as { startedAt?: unknown; done?: unknown };
    if (typeof o.startedAt !== "string" || !Number.isFinite(Date.parse(o.startedAt))) return null;
    const done = Array.isArray(o.done)
      ? [...new Set(o.done.filter((x): x is string => typeof x === "string"))].slice(0, 200)
      : [];
    return { startedAt: o.startedAt, done };
  } catch {
    return null;
  }
}

export type CoursePurchase = {
  orderItemId: string;
  orderId: number;
  productId: string;
  name: string;
  course: Course;
  /** null — курс ещё не начат (ссылку не выдавали). */
  run: CourseRun | null;
};

/**
 * Курс, купленный этой позицией заказа. Только выданный заказ (оплата
 * подтверждена, как у «Моих материалов») и только товар, у которого есть
 * уроки. Иначе null: ссылка на неоплаченный или удалённый курс ничего не
 * открывает.
 */
export async function coursePurchase(
  ctx: TenantContext,
  orderItemId: string,
): Promise<CoursePurchase | null> {
  const { data: item } = await ctx.db
    .from("order_items")
    .select("id, order_id, product_id, name_snapshot")
    .eq("id", orderItemId)
    .maybeSingle();
  if (!item?.product_id) return null;
  const { data: order } = await ctx.db
    .from("orders")
    .select("id, status")
    .eq("id", item.order_id)
    .maybeSingle();
  if (order?.status !== "delivered") return null;
  const course = parseCourse(await getSetting(ctx, courseKey(item.product_id)));
  if (course.lessons.length === 0) return null;
  return {
    orderItemId: item.id,
    orderId: item.order_id,
    productId: item.product_id,
    name: item.name_snapshot,
    course,
    run: parseRun(await getSetting(ctx, runKey(item.id))),
  };
}

/**
 * Начать прохождение: отсчёт расписания идёт с этого момента. Повторный
 * вызов ничего не меняет — дата начала ставится один раз.
 */
export async function startRun(
  ctx: TenantContext,
  p: CoursePurchase,
  now = new Date(),
): Promise<CourseRun> {
  if (p.run) return p.run;
  const run: CourseRun = { startedAt: now.toISOString(), done: [] };
  await trySetSetting(ctx, runKey(p.orderItemId), JSON.stringify(run));
  return run;
}

/** Отметка «пройден» / снятие отметки; только у открытого урока этого курса. */
export async function markLesson(
  ctx: TenantContext,
  p: CoursePurchase,
  lessonId: string,
  done: boolean,
  now = new Date(),
): Promise<CourseRun> {
  const run = await startRun(ctx, p, now);
  const lesson = lessonsAccess(p.course, run.startedAt, now.getTime()).find(
    (a) => a.lesson.id === lessonId,
  );
  if (!lesson?.open) return run;
  const set = new Set(run.done.filter((id) => p.course.lessons.some((l) => l.id === id)));
  if (done) set.add(lessonId);
  else set.delete(lessonId);
  const next = { ...run, done: [...set] };
  await trySetSetting(ctx, runKey(p.orderItemId), JSON.stringify(next));
  return next;
}
