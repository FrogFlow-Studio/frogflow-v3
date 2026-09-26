/** Чистые расчёты физического заказа: даты, задаток. */
export type PaymentMode = "full" | "deposit" | "on_receipt";

export function todayInTz(tz: string, now = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: tz });
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** «05.03.2026» → «2026-03-05»; иначе null. */
export function parseDateInput(text: string): string | null {
  const m = text.trim().match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function isoToDisplay(iso: string): string {
  const [y, mo, d] = iso.slice(0, 10).split("-");
  return `${d}.${mo}.${y}`;
}

export function addDaysToIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Сколько платить сейчас: всё, задаток или ничего (оплата при получении). */
export function amountDue(total: number, mode: PaymentMode, depositPercent: number): number {
  if (mode === "on_receipt") return 0;
  if (mode === "deposit") {
    const pct =
      Number.isFinite(depositPercent) && depositPercent >= 1 && depositPercent <= 100
        ? depositPercent
        : 30;
    return Math.round(total * (pct / 100));
  }
  return total;
}

export function matchFulfillmentType(text: string): "pickup" | "delivery" | null {
  const t = text.trim().toLowerCase();
  if (/самовывоз|заберу|сам|pickup|өзім|алып кетемін|olib ketaman/.test(t)) return "pickup";
  if (/доставк|привез|курьер|delivery|жеткіз|yetkaz/.test(t)) return "delivery";
  return null;
}

/**
 * Сколько ещё дописать к задатку при подтверждении чека: продавец мог уже
 * внести часть вручную до «Принять заказ» — тогда пишется только разница,
 * а не второй задаток сверху. Никогда не отрицательное.
 */
export function remainingDueNow(
  dueNow: number,
  paidAmount: number | string | null | undefined,
): number {
  if (!Number.isFinite(dueNow) || dueNow <= 0) return 0;
  const paid = Number(paidAmount);
  const already = Number.isFinite(paid) ? paid : 0;
  return Math.max(0, Math.round((dueNow - already) * 100) / 100);
}

export type FulfillmentZonePatch = { id: string; name: string; price: number };

export type FulfillmentTypePatch = {
  fulfillment_type?: "pickup" | "delivery";
  delivery_zone_id?: string | null;
  delivery_zone_name?: string | null;
  delivery_fee?: number;
  total?: number;
};

/**
 * Смена способа получения в админке. Доставка → самовывоз снимает зону и
 * комиссию с total, иначе в сумме и в остатке к оплате висит доставка,
 * которой не будет. Самовывоз → доставка прибавляет комиссию зоны; без
 * зоны меняется только тип (сервер зону требует). Смена зоны пересчитывает
 * комиссию, не складывая её поверх старой.
 */
export function fulfillmentTypePatch(
  order: { fulfillment_type: string | null; delivery_fee: number | null; total: number },
  nextType: "pickup" | "delivery" | null | undefined,
  zone?: FulfillmentZonePatch | null,
): FulfillmentTypePatch {
  if (!nextType) return {};
  const patch: FulfillmentTypePatch = { fulfillment_type: nextType };
  const oldFee = Number(order.delivery_fee) || 0;
  if (nextType === "pickup" && order.fulfillment_type === "delivery") {
    patch.delivery_zone_id = null;
    patch.delivery_zone_name = null;
    patch.delivery_fee = 0;
    patch.total = Math.max(0, Number(order.total) - oldFee);
    return patch;
  }
  if (nextType === "delivery" && zone) {
    const newFee = Number(zone.price) || 0;
    patch.delivery_zone_id = zone.id;
    patch.delivery_zone_name = zone.name;
    patch.delivery_fee = newFee;
    patch.total = Math.max(0, Number(order.total) - oldFee + newFee);
  }
  return patch;
}

/**
 * CHECK orders_paid_amount_le_total: снятая комиссия не должна опустить
 * total ниже уже внесённого — вместо сырой ошибки базы продавец получает
 * понятный отказ. Возврат разницы делается вне системы.
 */
export function fulfillmentTotalBelowPaid(patch: { total?: number }, paidAmount: number): boolean {
  return patch.total !== undefined && patch.total < paidAmount;
}

/** Живые физические заказы — ещё не выданы и не отклонены. */
export const OPEN_PHYSICAL_STATUSES: readonly string[] = [
  "awaiting_payment",
  "awaiting_confirmation",
  "accepted",
  "in_production",
  "ready",
  "delivering",
];

export type PickupFilter = "today" | "tomorrow" | "overdue" | "nodate";

/** Фильтр «к выдаче» в списке заказов: по календарному дню получения. */
export function matchesPickupFilter(
  order: { fulfillment_kind?: string | null; fulfillment_at: string | null; status: string },
  filter: PickupFilter,
  todayIso: string,
): boolean {
  if (order.fulfillment_kind !== "physical") return false;
  if (!OPEN_PHYSICAL_STATUSES.includes(order.status)) return false;
  const day = order.fulfillment_at ? String(order.fulfillment_at).slice(0, 10) : null;
  if (filter === "nodate") return !day;
  if (!day) return false;
  if (filter === "today") return day === todayIso;
  if (filter === "tomorrow") return day === addDaysToIso(todayIso, 1);
  return day < todayIso;
}
