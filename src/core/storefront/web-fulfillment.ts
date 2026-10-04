import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Customer } from "@/core/customers/customers";
import type { FulfillmentInput } from "@/core/orders/orders";
import type { Money } from "@/core/money/money";
import {
  activeDeliveryZones,
  fulfillmentSettings,
  checkFulfillmentDate,
  earliestFulfillmentDate,
  zoneFee,
} from "@/core/fulfillment/fulfillment";
import { closedRules, type ClosedRange } from "@/core/fulfillment/closed-days";
import { todayInTz } from "@/core/fulfillment/pure";
import { busyOverview, dateAvailability, freeSlotsOnDate } from "@/core/fulfillment/capacity";
import { fulfillmentSlots, withSlot } from "@/core/fulfillment/slots";

/**
 * Физический заказ с сайта: способ получения, дата, зона и адрес — те же
 * правила, что в боте (шаги awaiting_fulfillment_* в Instagram/WhatsApp),
 * только одной формой. Проверяет сервер; форма лишь подсказывает.
 */
export type WebFulfillmentRequest = {
  type: "pickup" | "delivery";
  /** YYYY-MM-DD из поля даты. */
  date: string;
  /** Слот «10:00–12:00» из списка магазина (core/fulfillment/slots). */
  slot?: string | null;
  zoneId?: string | null;
  address?: string | null;
  note?: string | null;
};

export type WebFulfillmentOptions = {
  pickup: boolean;
  delivery: boolean;
  zones: Array<{ id: string; name: string; fee: Money }>;
  /** Сегодня в поясе магазина: раньше дату не выбрать (срок изготовления — при оформлении). */
  today: string;
  /** Слоты получения; пусто — только дата. */
  slots: string[];
  /** Нерабочие дни недели (1 — пн … 7 — вс) и отрезки дат: форма подсказывает, сервер отклоняет. */
  closedWeekdays: number[];
  closedRanges: ClosedRange[];
  /** Даты, на которые заказы набраны (лимит на день или заняты все слоты), в ближайшие три месяца. */
  fullDays: string[];
  /** Дата → слоты, на которые места нет (только для дат, где остальные слоты свободны). */
  fullSlots: Record<string, string[]>;
};

export async function webFulfillmentOptions(
  ctx: TenantContext,
  countryCode: string | null,
): Promise<WebFulfillmentOptions> {
  const fs = await fulfillmentSettings(ctx);
  const zones = fs.delivery ? await activeDeliveryZones(ctx) : [];
  const rules = await closedRules(ctx);
  const slots = await fulfillmentSlots(ctx);
  const today = todayInTz(ctx.timezone);
  const { fullDays, fullSlots } = await busyOverview(ctx, today);
  return {
    pickup: fs.pickup,
    delivery: fs.delivery,
    zones: await Promise.all(
      zones.map(async (z) => ({
        id: z.id,
        name: z.name,
        fee: await zoneFee(ctx, z.price, countryCode),
      })),
    ),
    today,
    slots,
    closedWeekdays: rules.weekdays,
    closedRanges: rules.ranges,
    fullDays,
    fullSlots,
  };
}

export type WebFulfillmentCheck =
  | { ok: true; input: FulfillmentInput }
  | { ok: false; reason: "missing" | "type" | "date" | "slot" | "zone" | "address" }
  | { ok: false; reason: "date_early"; minDate: string }
  | { ok: false; reason: "date_closed"; nextDate: string }
  | { ok: false; reason: "date_full"; nextDate: string | null }
  | { ok: false; reason: "slot_full" };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function validIsoDate(s: string): boolean {
  if (!ISO_DATE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Проверить выбор покупателя по корзине в базе (срок изготовления — по её товарам). */
export async function resolveWebFulfillment(
  ctx: TenantContext,
  customer: Customer,
  req: WebFulfillmentRequest | null | undefined,
  countryCode: string,
): Promise<WebFulfillmentCheck> {
  if (!req) return { ok: false, reason: "missing" };
  const fs = await fulfillmentSettings(ctx);
  if (req.type === "pickup" ? !fs.pickup : !fs.delivery) return { ok: false, reason: "type" };
  if (!validIsoDate(req.date)) return { ok: false, reason: "date" };
  const rules = await closedRules(ctx);
  const date = checkFulfillmentDate(
    req.date,
    await earliestFulfillmentDate(ctx, customer, rules),
    rules,
  );
  if (!date.ok)
    return date.reason === "early"
      ? { ok: false, reason: "date_early", minDate: date.minDate }
      : { ok: false, reason: "date_closed", nextDate: date.nextDate };
  const avail = await dateAvailability(ctx, req.date, rules);
  if (!avail.ok) return { ok: false, reason: "date_full", nextDate: avail.nextDate };
  const note = req.note?.trim().slice(0, 500) || null;
  // Слот — только из списка магазина; есть слоты — без слота нельзя.
  const slots = await fulfillmentSlots(ctx);
  if (slots.length && !slots.includes(req.slot ?? "")) return { ok: false, reason: "slot" };
  if (slots.length && !(await freeSlotsOnDate(ctx, req.date)).includes(req.slot ?? ""))
    return { ok: false, reason: "slot_full" };
  const at = withSlot(req.date, slots.length ? req.slot : null);
  if (req.type === "pickup")
    return {
      ok: true,
      input: { type: "pickup", at, address: null, note, zone: null },
    };
  const address = req.address?.trim().slice(0, 500) ?? "";
  if (!address) return { ok: false, reason: "address" };
  const zones = await activeDeliveryZones(ctx);
  let zone: FulfillmentInput["zone"] = null;
  if (zones.length > 0) {
    const z = zones.find((x) => x.id === req.zoneId);
    if (!z) return { ok: false, reason: "zone" };
    zone = { id: z.id, name: z.name, fee: (await zoneFee(ctx, z.price, countryCode)).amount };
  }
  return { ok: true, input: { type: "delivery", at, address, note, zone } };
}
