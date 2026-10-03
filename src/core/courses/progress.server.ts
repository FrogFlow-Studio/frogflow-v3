import { displayNo } from "@/core/orders/pure";
import { pageAll } from "@/core/db/page";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { courseTimeline } from "./cohort";
import { courseKey, parseCourse } from "./course";
import { readSetting, readSettings, selectIn } from "./db.server";
import { inviteKey } from "./channel.server";
import { hwKey, parseHomework } from "./homework";
import { parseQuizResult, quizKey } from "./lesson-quiz";
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
  cohortId: string | null;
  /** Название варианта-тарифа; null — без вариантов. */
  tariff: string | null;
  homework: { submitted: number; accepted: number; revise: number };
  /** Тесты к урокам: сколько в курсе, сколько пройдено, всего попыток. */
  quiz: { lessons: number; passed: number; attempts: number };
  /** Открыто на 2 урока больше, чем пройдено, или есть работы на доработке. */
  behind: boolean;
  expired: boolean;
  /** Тариф со сроком доступа: можно продлить вручную. */
  accessLimited: boolean;
  /** Когда закончится доступ (ISO); null — бессрочно. */
  expiresAt: string | null;
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
  const course = parseCourse(await readSetting(ctx, courseKey(productId)));
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
  const quizLessons = course.lessons.filter((l) => l.quiz);
  const quizKeys = bought.flatMap((i) => quizLessons.map((l) => quizKey(i.id, l.id)));
  const [hwRaw, quizRaw, invRaw, variants] = await Promise.all([
    readSettings(ctx, hwKeys),
    readSettings(ctx, quizKeys),
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
    const parsedHw = new Map(
      course.lessons.flatMap((l) => {
        const h = l.homework ? parseHomework(hwRaw.get(hwKey(i.id, l.id))) : null;
        return h ? ([[l.id, h.status]] as const) : [];
      }),
    );
    const quizResults = new Map(
      quizLessons.map((l) => [l.id, parseQuizResult(quizRaw.get(quizKey(i.id, l.id)))] as const),
    );
    const tl = courseTimeline(
      {
        course,
        run,
        boughtAt: o.created_at,
        variantId: i.product_variant_id ?? null,
        hw: parsedHw,
        quiz: new Set([...quizResults].filter(([, r]) => r.passed).map(([id]) => id)),
      },
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
      cohortId: tl.cohort?.id ?? null,
      tariff: i.product_variant_id ? (variantName.get(i.product_variant_id) ?? null) : null,
      homework: hw,
      quiz: {
        lessons: quizLessons.length,
        passed: [...quizResults.values()].filter((r) => r.passed).length,
        attempts: [...quizResults.values()].reduce((n, r) => n + r.attempts, 0),
      },
      behind: !tl.expired && (open - done >= 2 || hw.revise > 0),
      expired: tl.expired,
      accessLimited: tl.tariff.accessDays != null,
      expiresAt: tl.expiresAt,
      inChannel: Boolean(inv.member) && !inv.revoked,
      channelRevoked: Boolean(inv.revoked),
    };
  });
  students.sort((a, b) => b.boughtAt.localeCompare(a.boughtAt));
  return { total, students };
}
