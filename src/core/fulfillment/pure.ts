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
