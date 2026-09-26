import type { Tenant } from "@/core/tenant/types";
import { parseMonthly } from "@/core/consultant/budget";
import { servedByV2 } from "@/core/tenant/directory";
import { planLimits } from "./plans";
import { parsePlan, type PlanLimits } from "./registry";

/** Месячные лимиты ИИ арендатора; null — не ограничиваем (без плана, по договору). */
export function tenantLimits(tenant: Pick<Tenant, "plan" | "settings">): PlanLimits | null {
  return planLimits(parsePlan(tenant.plan), tenant.settings.billing);
}

/**
 * Можно ли менять клиенту план (правило 6 CLAUDE.md). План переписывает
 * `bots.modules`, а их читает и живой бот на v1: пока клиент не переехал,
 * одна кнопка выключила бы ему модули. Возвращает причину отказа или null.
 */
export function planWriteBlock(tenant: Pick<Tenant, "settings">): string | null {
  return servedByV2(tenant)
    ? null
    : "Тариф назначается после переезда клиента на v2: пока его обслуживает v1, модули не трогаем.";
}

export const monthOf = (now = new Date()) => now.toISOString().slice(0, 7);

/** Ключи app_settings со счётчиками расхода ИИ за месяц. */
export const USAGE_KEYS = {
  receipts: "receipt_ocr_usage",
  dialogs: "consultant_dialogs_month",
} as const;

export type PlanUsage = {
  month: string;
  aiDialogs: number;
  receiptChecks: number;
  limits: PlanLimits | null;
};

/** Расход за месяц из значений app_settings — читает панель оператора и админка. */
export function planUsage(
  tenant: Pick<Tenant, "plan" | "settings">,
  values: Partial<Record<string, string | null>>,
  now = new Date(),
): PlanUsage {
  const month = monthOf(now);
  let receipts = 0;
  try {
    const r = JSON.parse(values[USAGE_KEYS.receipts] || "{}") as {
      month?: string;
      monthCount?: number;
    };
    receipts = r.month === month ? Math.max(0, Number(r.monthCount) || 0) : 0;
  } catch {
    receipts = 0;
  }
  return {
    month,
    aiDialogs: parseMonthly(values[USAGE_KEYS.dialogs], month).count,
    receiptChecks: receipts,
    limits: tenantLimits(tenant),
  };
}
