import type { TenantContext } from "@/core/tenant/resolve.server";
import { getSetting } from "@/core/settings/settings";

/**
 * Слоты получения физического заказа: «10:00–12:00», «12:00–14:00»… Продавец
 * задаёт их в настройках (app_settings `fulfillment_slots`, по строке на
 * слот); пусто — покупатель выбирает только дату, как раньше.
 *
 * Своей колонки у слота нет (схема заморожена): начало слота — время в
 * `orders.fulfillment_at` (часы продавца записаны как UTC, как и дата —
 * `YYYY-MM-DDT00:00:00Z`), так что дата, фильтр «к выдаче» и напоминание
 * за сутки работают по-прежнему. Слот восстанавливается по началу.
 * В состоянии оформления выбранный слот — тоже время в дате: `2026-09-30T10:00`.
 */
export const SLOTS_KEY = "fulfillment_slots";
export const MAX_SLOTS = 12;
const SLOT_RE = /^([01]?\d|2[0-3])[:.]([0-5]\d)\s*[-–—]\s*([01]?\d|2[0-3])[:.]([0-5]\d)$/;

const pad = (n: string) => n.padStart(2, "0");

/** Строка слота в виде «10:00–12:00»; не слот или конец не позже начала — null. */
export function normalizeSlot(raw: string): string | null {
  const m = SLOT_RE.exec(raw.trim());
  if (!m) return null;
  const from = `${pad(m[1]!)}:${m[2]}`;
  const to = `${pad(m[3]!)}:${m[4]}`;
  return from < to ? `${from}–${to}` : null;
}

/** Слоты из настройки: по строке или через запятую, без повторов, по времени начала. */
export function parseSlots(raw: string | null | undefined): string[] {
  const seen = new Set<string>();
  for (const part of (raw ?? "").split(/[\n,;]+/)) {
    const s = normalizeSlot(part);
    if (s) seen.add(s);
  }
  return [...seen].sort().slice(0, MAX_SLOTS);
}

export const slotStart = (slot: string) => slot.slice(0, 5);

export async function fulfillmentSlots(ctx: TenantContext): Promise<string[]> {
  return parseSlots(await getSetting(ctx, SLOTS_KEY));
}

/** Дата получения с выбранным слотом для состояния оформления: `YYYY-MM-DDTHH:MM`. */
export function withSlot(dateIso: string, slot: string | null | undefined): string {
  return slot ? `${dateIso.slice(0, 10)}T${slotStart(slot)}` : dateIso.slice(0, 10);
}

/**
 * Значение `orders.fulfillment_at`: дата и начало слота, если он из списка
 * магазина; иначе полночь (только дата). Чужое время — не слот: его отбросим.
 */
export function fulfillmentAtValue(at: string, slots: readonly string[]): string {
  const date = at.slice(0, 10);
  const time = /^\d{4}-\d{2}-\d{2}T(\d{2}:\d{2})/.exec(at)?.[1];
  const ok = time && slots.some((s) => slotStart(s) === time);
  return `${date}T${ok ? time : "00:00"}:00Z`;
}

/** Слот заказа по `fulfillment_at`: «10:00–12:00», «с 10:00», если слот убрали, или null. */
export function slotOf(
  fulfillmentAt: string | null | undefined,
  slots: readonly string[],
): string | null {
  const time = /T(\d{2}:\d{2})/.exec(String(fulfillmentAt ?? ""))?.[1];
  if (!time || time === "00:00") return null;
  return slots.find((s) => slotStart(s) === time) ?? `с ${time}`;
}
