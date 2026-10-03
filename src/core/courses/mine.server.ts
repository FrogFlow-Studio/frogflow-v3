import { env } from "@/config/env";
import type { Customer } from "@/core/customers/customers";
import { listDeliveredOrders } from "@/core/orders/orders";
import { storefrontBase } from "@/core/tenant/custom-domain";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { readSettings } from "./db.server";
import { nextOpening } from "./access";
import { loadHwStatusesFor } from "./gate.server";
import { courseTimeline } from "./cohort";
import { courseKey, parseCourse } from "./course";
import { hwKey, parseHomework, type HomeworkStatus } from "./homework";
import { courseToken, courseUrl } from "./link";
import { parseRun, runKey } from "./run.server";

/**
 * «Мои курсы» покупателя из Telegram: выданные покупки с уроками, сколько
 * открыто и пройдено, задания открытых уроков и есть ли закрытый канал.
 * Только чтение: прохождение не начинается от того, что ученик открыл список.
 */
export type MyCourseHomework = {
  lessonId: string;
  lessonNo: number;
  title: string;
  /** null — ещё не сдавал. */
  status: HomeworkStatus | null;
};

export type MyCourse = {
  orderItemId: string;
  name: string;
  /** Страница курса; null — у магазина нет адреса витрины. */
  url: string | null;
  total: number;
  open: number;
  done: number;
  /** Когда откроется следующий урок (ISO); null — открыты все. */
  nextAt: string | null;
  homework: MyCourseHomework[];
  /** Проверка ДЗ входит в тариф. */
  canSubmit: boolean;
  channel: boolean;
  /** У потока ученика есть групповой чат. */
  chat: boolean;
  cohort: { title: string; start: string } | null;
  beforeStart: boolean;
  expiresAt: string | null;
  expired: boolean;
};

export async function customerCourses(
  ctx: TenantContext,
  customer: Customer,
  now = new Date(),
): Promise<MyCourse[]> {
  if (!ctx.tenant.modules.courses) return [];
  const orders = await listDeliveredOrders(ctx, customer);
  const items = orders.flatMap((o) =>
    (o.order_items ?? []).flatMap((i) =>
      i.product_id
        ? [
            {
              id: i.id,
              productId: i.product_id,
              name: i.name_snapshot,
              boughtAt: o.created_at,
              variantId: i.product_variant_id ?? null,
            },
          ]
        : [],
    ),
  );
  if (items.length === 0) return [];
  const courseRaw = await readSettings(ctx, [...new Set(items.map((i) => courseKey(i.productId)))]);
  const withCourse = items.flatMap((i) => {
    const course = parseCourse(courseRaw.get(courseKey(i.productId)));
    return course.lessons.length ? [{ ...i, course }] : [];
  });
  if (withCourse.length === 0) return [];
  const runs = await readSettings(
    ctx,
    withCourse.map((i) => runKey(i.id)),
  );

  const taskHw = await loadHwStatusesFor(
    ctx,
    withCourse.filter((i) => i.course.schedule.mode === "tasks").map((i) => i.id),
  );
  const base = ctx.tenant.settings.slug ? storefrontBase(ctx.tenant, ctx.appUrl) : null;
  const secret = base ? env().SECRETS_KEY : "";
  const views = withCourse.map((i) => {
    const run = parseRun(runs.get(runKey(i.id)));
    const tl = courseTimeline({ ...i, run, hw: taskHw.get(i.id) }, ctx.timezone, now);
    const access = tl.access;
    const open = access.filter((a) => a.open);
    return {
      item: i,
      open,
      view: {
        orderItemId: i.id,
        name: i.name,
        url: base ? courseUrl(base, i.id, courseToken(secret, ctx.tenant.id, i.id)) : null,
        total: i.course.lessons.length,
        open: open.length,
        done: (run?.done ?? []).filter((id) => open.some((a) => a.lesson.id === id)).length,
        nextAt: tl.expired ? null : (nextOpening(access)?.opensAt ?? null),
        homework: [] as MyCourseHomework[],
        canSubmit: tl.tariff.homework,
        channel: Boolean(i.course.channel) && tl.tariff.channel && !tl.expired,
        chat: Boolean(tl.cohort?.chat) && tl.tariff.channel && !tl.expired,
        cohort: tl.cohort ? { title: tl.cohort.title, start: tl.start } : null,
        beforeStart: tl.beforeStart,
        expiresAt: tl.expiresAt,
        expired: tl.expired,
      },
    };
  });
  const hwKeys = views.flatMap((v) =>
    v.open.filter((a) => a.lesson.homework).map((a) => hwKey(v.item.id, a.lesson.id)),
  );
  const hw = hwKeys.length ? await readSettings(ctx, hwKeys) : new Map<string, string>();
  for (const v of views)
    v.view.homework = v.open
      .filter((a) => a.lesson.homework)
      .map((a) => ({
        lessonId: a.lesson.id,
        lessonNo: a.no,
        title: a.lesson.title,
        status: parseHomework(hw.get(hwKey(v.item.id, a.lesson.id)))?.status ?? null,
      }));
  return views.map((v) => v.view);
}
