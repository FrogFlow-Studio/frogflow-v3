import { displayNo } from "@/core/orders/pure";
import { pageAll } from "@/core/db/page";
import { getSetting } from "@/core/settings/settings";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { courseTimeline } from "./cohort";
import { courseKey, parseCourse } from "./course";
import { readSettings, selectIn } from "./db.server";
import { inviteKey } from "./channel.server";
import { hwKey, parseHomework } from "./homework";
import { parseRun, runKey } from "./run.server";

/**
 * Прогресс учеников курса для продавца: кто купил (выданный заказ), поток и
 * тариф, сколько уроков открыто и пройдено, как с заданиями, отстаёт ли,
 * вступил ли в закрытый канал. Только чтение.
 */
export type CourseStudent = {
  orderItemId: string;
  orderNo: number;
  buyer: string | null;
  boughtAt: string;
  /** null — покупатель ещё не открывал курс. */
  startedAt: string | null;
  open: number;
  done: number;
  cohort: string | null;
  /** Название варианта-тарифа; null — без вариантов. */
  tariff: string | null;
  homework: { submitted: number; accepted: number; revise: number };
  /** Открыто на 2 урока больше, чем пройдено, или есть работы на доработке. */
  behind: boolean;
  expired: boolean;
  /** Вступил в закрытый канал по личной ссылке. */
  inChannel: boolean;
  /** Доступ к каналу снят (возврат, конец срока, продавец). */
  channelRevoked: boolean;
};

export async function courseStudents(
  ctx: TenantContext,
  productId: string,
  now = new Date(),
): Promise<{ total: number; students: CourseStudent[] }> {
  const course = parseCourse(await getSetting(ctx, courseKey(productId)));
  const total = course.lessons.length;
  // Все покупки курса, постранично: ученик сверх первой сотни не теряется.
  const items = await pageAll<{ id: string; order_id: number; product_variant_id: string | null }>(
    (from, to) =>
      ctx.db
        .from("order_items")
        .select("id, order_id, product_variant_id")
        .eq("product_id", productId)
        .order("id")
        .range(from, to),
    "покупки курса",
  );
  if (!items.length) return { total, students: [] };
  const orders = await selectIn(
    "заказы учеников",
    items.map((i) => i.order_id),
    (chunk) =>
      ctx.db
        .from("orders")
        .select("id, order_no, display_no, display_name, created_at, status")
        .in("id", chunk as number[])
        .eq("status", "delivered"),
  );
  const orderById = new Map(orders.map((o) => [o.id, o]));
  const bought = items.filter((i) => orderById.has(i.order_id));
  const runs = await readSettings(
    ctx,
    bought.map((i) => runKey(i.id)),
  );
  const ids = new Set(course.lessons.map((l) => l.id));
  const hwKeys = bought.flatMap((i) =>
    course.lessons.filter((l) => l.homework).map((l) => hwKey(i.id, l.id)),
  );
  const [hwRaw, invRaw, variants] = await Promise.all([
    readSettings(ctx, hwKeys),
    readSettings(
      ctx,
      bought.map((i) => inviteKey(i.id)),
    ),
    selectIn<{ id: string; name: string }>(
      "тарифы курса",
      [...new Set(bought.flatMap((i) => (i.product_variant_id ? [i.product_variant_id] : [])))],
      (chunk) =>
        ctx.db
          .from("product_variants")
          .select("id, name")
          .in("id", chunk as string[]),
    ),
  ]);
  const variantName = new Map(variants.map((v) => [v.id, v.name]));
  const students = bought.map((i): CourseStudent => {
    const o = orderById.get(i.order_id)!;
    const run = parseRun(runs.get(runKey(i.id)));
    const tl = courseTimeline(
      { course, run, boughtAt: o.created_at, variantId: i.product_variant_id ?? null },
      ctx.timezone,
      now,
    );
    const open = run ? tl.access.filter((a) => a.open).length : 0;
    // Отметки удалённых уроков не считаем.
    const done = run ? run.done.filter((id) => ids.has(id)).length : 0;
    const hw = { submitted: 0, accepted: 0, revise: 0 };
    for (const l of course.lessons) {
      const h = l.homework ? parseHomework(hwRaw.get(hwKey(i.id, l.id))) : null;
      if (h) hw[h.status]++;
    }
    let inv: { member?: number; revoked?: string } = {};
    try {
      inv = JSON.parse(invRaw.get(inviteKey(i.id)) ?? "{}") as typeof inv;
    } catch {
      /* битая запись — как нет */
    }
    return {
      orderItemId: i.id,
      orderNo: displayNo(o),
      buyer: o.display_name ?? null,
      boughtAt: o.created_at,
      startedAt: run?.startedAt ?? null,
      open,
      done,
      cohort: tl.cohort?.title || null,
      tariff: i.product_variant_id ? (variantName.get(i.product_variant_id) ?? null) : null,
      homework: hw,
      behind: !tl.expired && (open - done >= 2 || hw.revise > 0),
      expired: tl.expired,
      inChannel: Boolean(inv.member) && !inv.revoked,
      channelRevoked: Boolean(inv.revoked),
    };
  });
  students.sort((a, b) => b.boughtAt.localeCompare(a.boughtAt));
  return { total, students };
}
