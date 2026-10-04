import type { TenantContext } from "@/core/tenant/resolve.server";
import { getSettingsStrict } from "@/core/settings/settings";
import { pageAll } from "@/core/db/page";
import { serverFailure } from "@/lib/server-failure";
import { addDaysToIso, OPEN_PHYSICAL_STATUSES } from "./pure";
import { fulfillmentSlots } from "./slots";
import { isClosedDay, type ClosedRules } from "./closed-days";

/**
 * Лимит заказов на день и на слот выдачи. Живёт в app_settings
 * (`fulfillment_day_limit`, `fulfillment_slot_limit`), схема не менялась;
 * пусто — без лимита, как раньше. Считаются физические заказы с датой выдачи,
 * кроме отклонённых, отменённых и возвращённых (в том числе просроченных
 * заказов с сайта — их отклоняет web-expire).
 *
 * Гонку двух покупателей на последнее место решает порядок номеров: заказ
 * создаётся, затем считается, какой он по счёту на этот день и слот; если
 * сверх лимита — он удаляется, покупатель получает честный отказ. Оба
 * одновременных заказа не пройдут (у каждого свой номер), а лишний уйдёт.
 */
export const DAY_LIMIT_KEY = "fulfillment_day_limit";
export const SLOT_LIMIT_KEY = "fulfillment_slot_limit";
export const MAX_LIMIT = 1000;
/** На сколько дней вперёд сайт показывает занятые даты. */
export const LOAD_WINDOW_DAYS = 90;

/** Статусы, которые занимают место: живые физические и уже выданные. */
export const COUNTED_STATUSES: readonly string[] = [...OPEN_PHYSICAL_STATUSES, "delivered"];

export type FulfillmentLimits = { day: number | null; slot: number | null };

/** «10» → 10; пусто, ноль, дробь и мусор — без лимита. */
export function parseLimit(raw: string | null | undefined): number | null {
  const t = (raw ?? "").trim();
  if (!/^\d{1,4}$/.test(t)) return null;
  const n = Number(t);
  return n >= 1 && n <= MAX_LIMIT ? n : null;
}

export const hasLimits = (l: FulfillmentLimits) => l.day !== null || l.slot !== null;

export async function fulfillmentLimits(ctx: TenantContext): Promise<FulfillmentLimits> {
  const s = await getSettingsStrict(ctx, [DAY_LIMIT_KEY, SLOT_LIMIT_KEY]);
  return { day: parseLimit(s[DAY_LIMIT_KEY]), slot: parseLimit(s[SLOT_LIMIT_KEY]) };
}

/** Загрузка одного дня: всего заказов и по слотам («10:00» → сколько). */
export type DayLoad = { total: number; slots: Record<string, number> };

const EMPTY: DayLoad = { total: 0, slots: {} };

const dayStart = (iso: string) => `${iso.slice(0, 10)}T00:00:00Z`;

/** Загрузка по дням в окне [fromIso, toIso] включительно; читается постранично, сортировка заканчивается номером заказа. */
export async function loadByDay(
  ctx: TenantContext,
  fromIso: string,
  toIso: string,
): Promise<Map<string, DayLoad>> {
  const rows = await pageAll<{ id: number; fulfillment_at: string | null }>(
    (from, to) =>
      ctx.db
        .from("orders")
        .select("id, fulfillment_at")
        .eq("fulfillment_kind", "physical")
        .in("status", [...COUNTED_STATUSES])
        .gte("fulfillment_at", dayStart(fromIso))
        .lt("fulfillment_at", dayStart(addDaysToIso(toIso, 1)))
        .order("id")
        .range(from, to),
    "Загрузка выдачи",
  );
  const out = new Map<string, DayLoad>();
  for (const r of rows) {
    if (!r.fulfillment_at) continue;
    const day = r.fulfillment_at.slice(0, 10);
    const load = out.get(day) ?? { total: 0, slots: {} };
    load.total++;
    const time = /T(\d{2}:\d{2})/.exec(r.fulfillment_at)?.[1];
    if (time && time !== "00:00") load.slots[time] = (load.slots[time] ?? 0) + 1;
    out.set(day, load);
  }
  return out;
}

export async function loadOfDay(ctx: TenantContext, dayIso: string): Promise<DayLoad> {
  return (await loadByDay(ctx, dayIso, dayIso)).get(dayIso.slice(0, 10)) ?? EMPTY;
}

export const dayIsFull = (load: DayLoad | undefined, limits: FulfillmentLimits): boolean =>
  limits.day !== null && (load?.total ?? 0) >= limits.day;

export const slotIsFull = (
  load: DayLoad | undefined,
  slot: string,
  limits: FulfillmentLimits,
): boolean => {
  if (dayIsFull(load, limits)) return true;
  return limits.slot !== null && (load?.slots[slot.slice(0, 5)] ?? 0) >= limits.slot;
};

/** Слоты дня, на которые ещё есть место (день с лимитом на день и полный — ни одного). */
export function freeSlots(
  slots: readonly string[],
  load: DayLoad | undefined,
  limits: FulfillmentLimits,
): string[] {
  return slots.filter((s) => !slotIsFull(load, s, limits));
}

/**
 * День занят: полон по лимиту на день или, при слотах и лимите на слот, заняты все слоты.
 * Без слотов лимит на слот не действует (слота у заказа нет).
 */
export function dayUnavailable(
  load: DayLoad | undefined,
  slots: readonly string[],
  limits: FulfillmentLimits,
): boolean {
  if (dayIsFull(load, limits)) return true;
  return slots.length > 0 && limits.slot !== null && freeSlots(slots, load, limits).length === 0;
}

/** Ближайший не занятый день не раньше `fromIso` (нерабочие дни — забота вызывающего); null — в окне нет. */
export function nextFreeDay(
  fromIso: string,
  loads: Map<string, DayLoad>,
  slots: readonly string[],
  limits: FulfillmentLimits,
  isClosed: (iso: string) => boolean,
): string | null {
  let day = fromIso.slice(0, 10);
  for (let i = 0; i < LOAD_WINDOW_DAYS; i++, day = addDaysToIso(day, 1)) {
    if (isClosed(day)) continue;
    if (!dayUnavailable(loads.get(day), slots, limits)) return day;
  }
  return null;
}

/**
 * Заказ только что создан: не сверх ли он лимита? Считаем заказы того же дня (и
 * слота) с номером не больше его собственного — это его место в очереди.
 * "day" / "slot" — сверх лимита, заказ надо снять; null — место есть.
 */
export async function orderOverLimit(
  ctx: TenantContext,
  order: { id: number; fulfillment_at: string | null },
  limits: FulfillmentLimits,
): Promise<"day" | "slot" | null> {
  if (!order.fulfillment_at || !hasLimits(limits)) return null;
  const day = order.fulfillment_at.slice(0, 10);
  const count = async (exact: string | null): Promise<number> => {
    let q = ctx.db
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("fulfillment_kind", "physical")
      .in("status", [...COUNTED_STATUSES])
      .lte("id", order.id);
    q = exact
      ? q.eq("fulfillment_at", exact)
      : q.gte("fulfillment_at", dayStart(day)).lt("fulfillment_at", dayStart(addDaysToIso(day, 1)));
    const { count: n, error } = await q;
    if (error) throw serverFailure(`Загрузка выдачи: ${error.message}`);
    return n ?? 0;
  };
  if (limits.day !== null && (await count(null)) > limits.day) return "day";
  const time = /T(\d{2}:\d{2})/.exec(order.fulfillment_at)?.[1];
  if (
    limits.slot !== null &&
    time &&
    time !== "00:00" &&
    (await count(order.fulfillment_at)) > limits.slot
  )
    return "slot";
  return null;
}

export type DateAvailability = { ok: true } | { ok: false; nextDate: string | null };

/**
 * Можно ли взять заказ на дату: без лимитов — всегда; день занят — отказ с
 * ближайшим свободным рабочим днём (null — в ближайшие три месяца нет).
 * Одно правило для бота, Direct/WhatsApp и сайта.
 */
export async function dateAvailability(
  ctx: TenantContext,
  iso: string,
  rules: ClosedRules,
): Promise<DateAvailability> {
  const limits = await fulfillmentLimits(ctx);
  if (!hasLimits(limits)) return { ok: true };
  const day = iso.slice(0, 10);
  const slots = await fulfillmentSlots(ctx);
  const loads = await loadByDay(ctx, day, addDaysToIso(day, LOAD_WINDOW_DAYS));
  if (!dayUnavailable(loads.get(day), slots, limits)) return { ok: true };
  return {
    ok: false,
    nextDate: nextFreeDay(addDaysToIso(day, 1), loads, slots, limits, (d) => isClosedDay(d, rules)),
  };
}

/** Слоты даты, на которые ещё есть место; без лимитов — все слоты магазина. */
export async function freeSlotsOnDate(ctx: TenantContext, iso: string): Promise<string[]> {
  const slots = await fulfillmentSlots(ctx);
  const limits = await fulfillmentLimits(ctx);
  if (!slots.length || !hasLimits(limits)) return slots;
  return freeSlots(slots, await loadOfDay(ctx, iso), limits);
}

export type LoadSummaryDay = {
  date: string;
  total: number;
  /** Слоты дня с числом заказов; пусто, если слотов у магазина нет. */
  slots: Array<{ slot: string; count: number }>;
};

/** Загрузка сегодняшнего и завтрашнего дня для «К выдаче»; null — лимиты не заданы, показывать нечего. */
export async function loadSummary(
  ctx: TenantContext,
  todayIso: string,
): Promise<{ limits: FulfillmentLimits; days: LoadSummaryDay[] } | null> {
  const limits = await fulfillmentLimits(ctx);
  if (!hasLimits(limits)) return null;
  const tomorrow = addDaysToIso(todayIso, 1);
  const [slots, loads] = await Promise.all([
    fulfillmentSlots(ctx),
    loadByDay(ctx, todayIso, tomorrow),
  ]);
  const days = [todayIso, tomorrow].map((date) => {
    const l = loads.get(date) ?? EMPTY;
    return {
      date,
      total: l.total,
      slots: slots.map((slot) => ({ slot, count: l.slots[slot.slice(0, 5)] ?? 0 })),
    };
  });
  return { limits, days };
}

/** Занятые даты и слоты в ближайшие три месяца — для формы сайта и ручного заказа; без лимитов пусто. */
export async function busyOverview(
  ctx: TenantContext,
  todayIso: string,
): Promise<{ fullDays: string[]; fullSlots: Record<string, string[]> }> {
  const limits = await fulfillmentLimits(ctx);
  const fullDays: string[] = [];
  const fullSlots: Record<string, string[]> = {};
  if (!hasLimits(limits)) return { fullDays, fullSlots };
  const slots = await fulfillmentSlots(ctx);
  const loads = await loadByDay(ctx, todayIso, addDaysToIso(todayIso, LOAD_WINDOW_DAYS));
  for (const [day, load] of loads) {
    if (dayUnavailable(load, slots, limits)) fullDays.push(day);
    else {
      const free = freeSlots(slots, load, limits);
      if (free.length < slots.length) fullSlots[day] = slots.filter((x) => !free.includes(x));
    }
  }
  return { fullDays: fullDays.sort(), fullSlots };
}
