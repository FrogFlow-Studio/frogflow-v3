/**
 * Воронка продлений: чистая часть — какое напоминание пора слать и как хранится
 * отметка «уже слали». Отправка — в renewals.server.ts.
 */
import { billableAddons, planInvoice } from "@/core/plans/plans";
import { ADDON_MONTHLY_PRICE, ADDONS, parsePlan, planMonthlyPrice } from "@/core/plans/registry";
import type { BillingPeriod, Tenant } from "@/core/tenant/types";

export type RenewalStage = "d7" | "d3" | "d1" | "d0";

/** Отметки клиента (`app_settings`): `<дата конца>:d7,d3,d7m` — буква m у письма. */
export const RENEWAL_KEY = "renewal_reminded";

/**
 * Какое напоминание пора: ровно то, что соответствует сегодняшнему окну
 * (7–4 дня → d7, 3–2 → d3, 1 → d1, 0 → d0). Пропущенные раньше не досылаем:
 * «через 7 дней» за день до конца было бы неправдой. Просрочку ведёт обход
 * подписок. Уже отправленное — null.
 */
export function dueRenewalStage(daysLeft: number, sent: readonly string[]): RenewalStage | null {
  const stage: RenewalStage | null =
    daysLeft < 0 || daysLeft > 7
      ? null
      : daysLeft === 0
        ? "d0"
        : daysLeft === 1
          ? "d1"
          : daysLeft <= 3
            ? "d3"
            : "d7";
  return stage && !sent.includes(stage) ? stage : null;
}

/** Метки текущего срока; метки прошлого срока (клиент оплатил, дата ушла вперёд) не считаются. */
export function marksFor(raw: string | null, expires: string): string[] {
  if (!raw?.startsWith(`${expires}:`)) return [];
  return raw
    .slice(expires.length + 1)
    .split(",")
    .filter(Boolean);
}

/** Новое значение с отметкой; null — отметка уже стоит (условная запись не пишет). */
export function addMark(raw: string | null, expires: string, mark: string): string | null {
  const have = marksFor(raw, expires);
  return have.includes(mark) ? null : `${expires}:${[...have, mark].join(",")}`;
}

/** Снять отметку (отправка точно не состоялась); null — снимать нечего. */
export function dropMark(raw: string | null, expires: string, mark: string): string | null {
  const have = marksFor(raw, expires);
  return have.includes(mark) ? `${expires}:${have.filter((m) => m !== mark).join(",")}` : null;
}

export type RenewalRow = {
  botId: string;
  name: string;
  servedBy: "v1" | "v2" | null;
  expires: string;
  daysLeft: number;
  /** Цена продления, ₸; null — клиент не на плане, цену называют вручную. */
  amount: number | null;
};

/** Список «заканчивается в N дней» и итог «ожидается ₸» (клиенты без плана в сумму не входят). */
export function renewalSummary(rows: RenewalRow[], withinDays: number) {
  const list = rows
    .filter((r) => r.daysLeft >= 0 && r.daysLeft <= withinDays)
    .sort((a, b) => a.daysLeft - b.daysLeft || a.botId.localeCompare(b.botId));
  return {
    list,
    expected: list.reduce((s, r) => s + (r.amount ?? 0), 0),
    noPrice: list.filter((r) => r.amount === null).length,
    overdue: rows.filter((r) => r.daysLeft < 0).length,
  };
}

/**
 * Цена продления на следующий период: план × период и надбавки по базовым
 * ценам, без подключения (к продлению оно не относится). null — клиент не на
 * плане (индивидуальные условия): цену оператор называет сам.
 */
export function renewalPrice(
  t: Pick<Tenant, "plan" | "settings">,
): { amount: number; period: BillingPeriod } | null {
  const parsed = parsePlan(t.plan);
  if (parsed?.kind !== "tier") return null;
  const billing = t.settings.billing ?? {};
  const period = billing.period ?? "month";
  const inv = planInvoice(parsed.tier, {
    period,
    monthlyPrice: planMonthlyPrice(parsed.tier, billing),
    withConnection: false,
    addons: billableAddons(parsed.niche, parsed.tier, billing.addons).map((a) => ({
      title: ADDONS[a].title,
      monthly: ADDON_MONTHLY_PRICE[a],
    })),
  });
  return { amount: inv.amount, period };
}
