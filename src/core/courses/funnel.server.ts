import { displayNo } from "@/core/orders/pure";
import { pageAll } from "@/core/db/page";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { certificateReady } from "./certificate";
import { courseTimeline } from "./cohort";
import { courseKey, parseCourse } from "./course";
import { readSetting, readSettings, selectIn } from "./db.server";
import {
  buildFunnel,
  pickFunnel,
  type CourseFunnel,
  type FunnelKind,
  type FunnelRow,
} from "./funnel";
import { hwKey, parseHomework, type HomeworkStatus } from "./homework";
import { parseQuizResult, quizKey } from "./lesson-quiz";
import { parseRun, runKey } from "./run.server";

/**
 * Воронка курса по потоку (core/courses/funnel). Читает все покупки курса
 * постранично, а сбой чтения — ошибка (`serverFailure`), не нули: пустая
 * воронка при упавшей базе выглядела бы как «все отвалились».
 */
type Loaded = {
  lessons: Array<{ title: string; hasHomework: boolean; hasQuiz: boolean }>;
  cohorts: Array<{ id: string; title: string }>;
  rows: Array<FunnelRow & { orderNo: number; buyer: string | null; cohortId: string | null }>;
};

async function loadFunnelRows(ctx: TenantContext, productId: string, now: Date): Promise<Loaded> {
  const course = parseCourse(await readSetting(ctx, courseKey(productId)));
  const lessons = course.lessons.map((l) => ({
    title: l.title,
    hasHomework: Boolean(l.homework),
    hasQuiz: Boolean(l.quiz),
  }));
  const cohorts = (course.cohorts ?? []).map((c) => ({ id: c.id, title: c.title }));
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
  if (!items.length) return { lessons, cohorts, rows: [] };
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
  const quizLessons = course.lessons.filter((l) => l.quiz);
  const [runs, hwRaw, quizRaw] = await Promise.all([
    readSettings(
      ctx,
      bought.map((i) => runKey(i.id)),
    ),
    readSettings(
      ctx,
      bought.flatMap((i) => course.lessons.filter((l) => l.homework).map((l) => hwKey(i.id, l.id))),
    ),
    readSettings(
      ctx,
      bought.flatMap((i) => quizLessons.map((l) => quizKey(i.id, l.id))),
    ),
  ]);
  const rows = bought.map((i) => {
    const o = orderById.get(i.order_id)!;
    const run = parseRun(runs.get(runKey(i.id)));
    const hw = course.lessons.map((l) =>
      l.homework ? (parseHomework(hwRaw.get(hwKey(i.id, l.id)))?.status ?? null) : null,
    );
    // Режим «по заданиям»: открытость уроков зависит от сдач.
    const status = new Map<string, HomeworkStatus>(
      course.lessons.flatMap((l, k) => (hw[k] ? ([[l.id, hw[k]!]] as const) : [])),
    );
    const passedQuiz = new Set(
      quizLessons
        .filter((l) => parseQuizResult(quizRaw.get(quizKey(i.id, l.id))).passed)
        .map((l) => l.id),
    );
    const tl = courseTimeline(
      {
        course,
        run,
        boughtAt: o.created_at,
        variantId: i.product_variant_id ?? null,
        hw: status,
        quiz: passedQuiz,
      },
      ctx.timezone,
      now,
    );
    // Прохождение не начато — ни один урок не открывал (как в списке учеников).
    const opened = tl.access.map((a) => Boolean(run) && a.open);
    const doneIds = new Set(run?.done ?? []);
    const done = course.lessons.map((l) => doneIds.has(l.id));
    const finished =
      Boolean(run) &&
      certificateReady({
        lessons: course.lessons.map((l) => ({ id: l.id, homework: l.homework ?? null })),
        open: new Set(tl.access.filter((a) => a.open).map((a) => a.lesson.id)),
        done: doneIds,
        homework: status,
        checksHomework: tl.tariff.homework,
      });
    return {
      itemId: i.id,
      opened,
      hw,
      quiz: course.lessons.map((l) => passedQuiz.has(l.id)),
      done,
      finished,
      orderNo: displayNo(o),
      buyer: o.display_name ?? null,
      cohortId: tl.cohort?.id ?? null,
    };
  });
  return { lessons, cohorts, rows };
}

const inScope = <T extends { cohortId: string | null }>(rows: T[], cohortId: string | null) =>
  cohortId ? rows.filter((r) => r.cohortId === cohortId) : rows;

export async function courseFunnel(
  ctx: TenantContext,
  productId: string,
  cohortId: string | null,
  now = new Date(),
): Promise<CourseFunnel & { cohorts: Array<{ id: string; title: string }> }> {
  const { lessons, cohorts, rows } = await loadFunnelRows(ctx, productId, now);
  return { ...buildFunnel(lessons, inScope(rows, cohortId)), cohorts };
}

/** Список учеников шага воронки — по клику на цифру. */
export async function funnelStudents(
  ctx: TenantContext,
  productId: string,
  cohortId: string | null,
  kind: FunnelKind,
  lessonNo: number,
  now = new Date(),
): Promise<Array<{ orderItemId: string; orderNo: number; buyer: string | null }>> {
  const { rows } = await loadFunnelRows(ctx, productId, now);
  return pickFunnel(inScope(rows, cohortId), kind, lessonNo)
    .map((r) => {
      const full = rows.find((x) => x.itemId === r.itemId)!;
      return { orderItemId: r.itemId, orderNo: full.orderNo, buyer: full.buyer };
    })
    .sort((a, b) => a.orderNo - b.orderNo || a.orderItemId.localeCompare(b.orderItemId));
}
