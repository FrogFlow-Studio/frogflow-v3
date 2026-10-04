import { pageAll } from "@/core/db/page";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { courseKey, hasCourseContent, parseCourse, type Course } from "./course";
import type { TaskGate } from "./access";
import { loadHwStatusesFor, loadQuizPassedFor } from "./gate.server";
import { readSettings, selectIn } from "./db.server";
import { parseRun, RUN_KEY_PREFIX, type CourseRun } from "./run.server";

/**
 * Все прохождения курсов клиента с позицией, заказом и курсом — для кронов
 * (новый урок, напоминания, конец доступа). Постранично, .in() кусками;
 * сбой чтения — ошибка, а не «прохождений нет».
 */
export type ActiveRun = {
  itemId: string;
  productId: string;
  /** Название курса в заказе. */
  name: string;
  run: CourseRun;
  course: Course;
  variantId: string | null;
  /** Сдачи ДЗ по урокам — только у курсов в режиме «по заданиям». */
  hw?: TaskGate["hw"];
  quiz?: TaskGate["quiz"];
  order: {
    id: number;
    status: string;
    platform: string | null;
    telegram_id: number | null;
    created_at: string;
  };
};

export async function loadRuns(ctx: TenantContext, onlyItemId?: string): Promise<ActiveRun[]> {
  const rows = await pageAll<{ key: string; value: string | null }>((from, to) => {
    const q = ctx.db.from("app_settings").select("key, value");
    return (
      onlyItemId
        ? q.eq("key", `${RUN_KEY_PREFIX}${onlyItemId}`)
        : q.like("key", `${RUN_KEY_PREFIX}%`)
    )
      .order("key")
      .range(from, to);
  }, "прохождения курсов");
  const runs = rows.flatMap((r) => {
    const run = r.key.startsWith(RUN_KEY_PREFIX) ? parseRun(r.value) : null;
    return run ? [{ itemId: r.key.slice(RUN_KEY_PREFIX.length), run }] : [];
  });
  if (runs.length === 0) return [];
  const items = await selectIn<{
    id: string;
    order_id: number;
    product_id: string | null;
    product_variant_id: string | null;
    name_snapshot: string;
  }>(
    "позиции курсов",
    runs.map((r) => r.itemId),
    (chunk) =>
      ctx.db
        .from("order_items")
        .select("id, order_id, product_id, product_variant_id, name_snapshot")
        .in("id", chunk as string[]),
  );
  const orders = await selectIn<ActiveRun["order"]>(
    "заказы курсов",
    items.map((i) => i.order_id),
    (chunk) =>
      ctx.db
        .from("orders")
        .select("id, status, platform, telegram_id, created_at")
        .in("id", chunk as number[]),
  );
  const productIds = [...new Set(items.flatMap((i) => (i.product_id ? [i.product_id] : [])))];
  const courseRaw = await readSettings(ctx, productIds.map(courseKey));
  const itemById = new Map(items.map((i) => [i.id, i]));
  const orderById = new Map(orders.map((o) => [o.id, o]));
  const courses = new Map<string, Course>();
  for (const id of productIds) courses.set(id, parseCourse(courseRaw.get(courseKey(id))));
  const taskItems = runs.filter((r) => {
    const pid = itemById.get(r.itemId)?.product_id;
    return pid ? courses.get(pid)?.schedule.mode === "tasks" : false;
  });
  const hwByItem = await loadHwStatusesFor(
    ctx,
    taskItems.map((r) => r.itemId),
  );
  const quizByItem = await loadQuizPassedFor(
    ctx,
    taskItems.map((r) => r.itemId),
  );
  return runs.flatMap((r) => {
    const item = itemById.get(r.itemId);
    const order = item ? orderById.get(item.order_id) : undefined;
    const course = item?.product_id ? courses.get(item.product_id) : undefined;
    return item && order && course && hasCourseContent(course)
      ? [
          {
            itemId: r.itemId,
            productId: item.product_id!,
            name: item.name_snapshot,
            run: r.run,
            course,
            variantId: item.product_variant_id,
            ...(hwByItem.has(r.itemId) ? { hw: hwByItem.get(r.itemId) } : {}),
            ...(quizByItem.has(r.itemId) ? { quiz: quizByItem.get(r.itemId) } : {}),
            order,
          },
        ]
      : [];
  });
}
