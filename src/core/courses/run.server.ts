import type { TenantContext } from "@/core/tenant/resolve.server";
import { serverFailure } from "@/lib/server-failure";
import { updateSettingAtomic } from "@/core/settings/settings";
import { cohortForPurchase, courseTimeline, type Timeline } from "./cohort";
import { courseKey, parseCourse, type Course } from "./course";
import { readSetting } from "./db.server";

/**
 * Прохождение курса одной покупкой (позицией заказа): когда начато и какие
 * уроки пройдены. Схему не меняем — JSON в `app_settings.course_run_<id позиции>`.
 * Ключ по позиции, а не по покупателю: у покупателей из Instagram и WhatsApp
 * нет telegram_id, а позиция заказа есть в любом канале.
 */
export const RUN_KEY_PREFIX = "course_run_";
export const runKey = (orderItemId: string) => `${RUN_KEY_PREFIX}${orderItemId}`;

export type CourseRun = {
  startedAt: string;
  done: string[];
  /** Сколько открытых уроков покупатель уже знает (сообщение бота о новом уроке). */
  notified?: number;
  /** Поток (core/courses/cohort): выбирается один раз, по дате покупки. */
  cohortId?: string;
  /** За сколько дней до старта потока уже напомнили (core/courses/reminders). */
  pre?: number[];
  /** Уроки, о несданном задании которых уже напомнили. */
  hwReminded?: string[];
  /** Когда снят доступ к каналу по окончании срока тарифа. */
  accessEnded?: string;
  /** Доступ продлён вручную до этого момента (ISO): не раньше срока тарифа. */
  until?: string;
};

export function parseRun(raw: string | null | undefined): CourseRun | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as { startedAt?: unknown; done?: unknown };
    if (typeof o.startedAt !== "string" || !Number.isFinite(Date.parse(o.startedAt))) return null;
    const done = Array.isArray(o.done)
      ? [...new Set(o.done.filter((x): x is string => typeof x === "string"))].slice(0, 200)
      : [];
    const x = o as {
      notified?: unknown;
      cohortId?: unknown;
      pre?: unknown;
      hwReminded?: unknown;
      accessEnded?: unknown;
      until?: unknown;
    };
    const n = x.notified;
    const pre = Array.isArray(x.pre)
      ? [...new Set(x.pre.filter((d): d is number => Number.isInteger(d)))].slice(0, 10)
      : [];
    const hw = Array.isArray(x.hwReminded)
      ? [...new Set(x.hwReminded.filter((d): d is string => typeof d === "string"))].slice(0, 200)
      : [];
    return {
      startedAt: o.startedAt,
      done,
      ...(Number.isInteger(n) && (n as number) >= 0 ? { notified: n as number } : {}),
      ...(typeof x.cohortId === "string" && x.cohortId
        ? { cohortId: x.cohortId.slice(0, 36) }
        : {}),
      ...(pre.length ? { pre } : {}),
      ...(hw.length ? { hwReminded: hw } : {}),
      ...(typeof x.accessEnded === "string" ? { accessEnded: x.accessEnded } : {}),
      ...(typeof x.until === "string" && Number.isFinite(Date.parse(x.until))
        ? { until: x.until }
        : {}),
    };
  } catch {
    return null;
  }
}

export type CoursePurchase = {
  orderItemId: string;
  orderId: number;
  /** Когда оформлен заказ: по этой дате выбирается поток. */
  boughtAt: string;
  /** Вариант товара = тариф курса; null — без вариантов. */
  variantId: string | null;
  /** Покупатель из Telegram (сверка владельца в боте); у Direct и сайта — null. */
  telegramId: number | null;
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
  const { data: item, error: itemError } = await ctx.db
    .from("order_items")
    .select("id, order_id, product_id, product_variant_id, name_snapshot")
    .eq("id", orderItemId)
    .maybeSingle();
  if (itemError) throw serverFailure(`Покупка курса не прочитана: ${itemError.message}`);
  if (!item?.product_id) return null;
  const { data: order, error: orderError } = await ctx.db
    .from("orders")
    .select("id, status, telegram_id, created_at")
    .eq("id", item.order_id)
    .maybeSingle();
  if (orderError) throw serverFailure(`Заказ курса не прочитан: ${orderError.message}`);
  if (order?.status !== "delivered") return null;
  const course = parseCourse(await readSetting(ctx, courseKey(item.product_id)));
  if (course.lessons.length === 0) return null;
  return {
    orderItemId: item.id,
    orderId: item.order_id,
    boughtAt: order.created_at,
    variantId: item.product_variant_id ?? null,
    telegramId: order.telegram_id ?? null,
    productId: item.product_id,
    name: item.name_snapshot,
    course,
    run: parseRun(await readSetting(ctx, runKey(item.id))),
  };
}

/** Календарь этой покупки в поясе магазина (поток, тариф, открытые уроки). */
export function purchaseTimeline(
  ctx: TenantContext,
  p: Pick<CoursePurchase, "course" | "run" | "boughtAt" | "variantId">,
  now = new Date(),
): Timeline {
  return courseTimeline(p, ctx.timezone, now);
}

/**
 * Начать прохождение: отсчёт расписания идёт с этого момента, у курса с
 * потоками — со старта потока, выбранного по дате покупки. Запись
 * создаётся один раз (условной вставкой): повтор и гонка вернут первую.
 */
export async function startRun(
  ctx: TenantContext,
  p: CoursePurchase,
  now = new Date(),
): Promise<CourseRun> {
  if (p.run) return p.run;
  const cohort = cohortForPurchase(p.course, new Date(p.boughtAt), ctx.timezone);
  const draft: CourseRun = {
    startedAt: now.toISOString(),
    done: [],
    ...(cohort ? { cohortId: cohort.id } : {}),
  };
  // Уроки, открытые в момент начала, покупатель видит сам: о них бот не пишет.
  draft.notified = purchaseTimeline(ctx, { ...p, run: draft }, now).access.filter(
    (a) => a.open,
  ).length;
  let existing: CourseRun | null = null;
  await updateSettingAtomic(ctx, runKey(p.orderItemId), (raw) => {
    existing = parseRun(raw);
    return existing ? null : JSON.stringify(draft);
  });
  return existing ?? draft;
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
  const lesson = purchaseTimeline(ctx, { ...p, run }, now).access.find(
    (a) => a.lesson.id === lessonId,
  );
  if (!lesson?.open) return run;
  let next = run;
  // Меняем только отметки: отметку о сообщении (notified) пишет крон — не затираем.
  await updateSettingAtomic(ctx, runKey(p.orderItemId), (raw) => {
    const cur = parseRun(raw) ?? run;
    const set = new Set(cur.done.filter((id) => p.course.lessons.some((l) => l.id === id)));
    if (done) set.add(lessonId);
    else set.delete(lessonId);
    next = { ...cur, done: [...set] };
    return JSON.stringify(next);
  });
  return next;
}

/**
 * Прохождение начинается с выдачи курса: у курса с потоком ученик сразу
 * записан в свой поток и получит сообщение о первом уроке в день старта,
 * даже если ещё не открывал страницу. Повторная выдача ничего не меняет.
 */
export async function startRunAtDelivery(
  ctx: TenantContext,
  item: {
    id: string;
    order_id: number;
    product_id: string | null;
    product_variant_id?: string | null;
  },
  now = new Date(),
): Promise<void> {
  if (!item.product_id) return;
  const course = parseCourse(await readSetting(ctx, courseKey(item.product_id)));
  if (course.lessons.length === 0) return;
  const { data: order, error } = await ctx.db
    .from("orders")
    .select("created_at")
    .eq("id", item.order_id)
    .maybeSingle();
  if (error) throw serverFailure(`Заказ для записи прохождения не прочитан: ${error.message}`);
  if (!order) return;
  await startRun(
    ctx,
    {
      orderItemId: item.id,
      orderId: item.order_id,
      boughtAt: order.created_at,
      variantId: item.product_variant_id ?? null,
      telegramId: null,
      productId: item.product_id,
      name: "",
      course,
      run: parseRun(await readSetting(ctx, runKey(item.id))),
    },
    now,
  );
}
