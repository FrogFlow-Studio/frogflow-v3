import { serviceDb } from "@/core/db/client.server";
import { eachPage } from "@/core/db/page";
import { dayKey } from "@/core/analytics/pure";
import { refundsSince } from "@/core/orders/refund";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { serverFailure } from "@/lib/server-failure";
import { monthCommission, type CommissionMonth, type CommissionOrder } from "./commission";

/**
 * Общий выключатель комиссии платформы: `operator_settings.v3_commission`
 * (своё имя, чтобы не совпасть с ключами v1), по умолчанию выключен — включает
 * только оператор по слову Якова. Нет записи или не читается как `true` —
 * выключен: упавшее чтение выключателя не должно включить начисление, а
 * ошибку отдаём наружу, чтобы счёт не выставился по догадке.
 */
export const COMMISSION_SWITCH_KEY = "v3_commission";

export async function commissionEnabled(): Promise<boolean> {
  const { data, error } = await serviceDb()
    .from("operator_settings")
    .select("value")
    .eq("key", COMMISSION_SWITCH_KEY)
    .maybeSingle();
  if (error) throw serverFailure(`выключатель комиссии не прочитан: ${error.message}`);
  if (!data?.value) return false;
  try {
    return (JSON.parse(String(data.value)) as { enabled?: unknown }).enabled === true;
  } catch {
    return false;
  }
}

export async function setCommissionEnabled(enabled: boolean): Promise<void> {
  const { error } = await serviceDb()
    .from("operator_settings")
    .upsert(
      { key: COMMISSION_SWITCH_KEY, value: JSON.stringify({ enabled }) },
      { onConflict: "key" },
    );
  if (error) throw serverFailure(`выключатель комиссии не сохранён: ${error.message}`);
}

const DAY_MS = 86_400_000;

/** Границы месяца `ГГГГ-ММ` с запасом в сутки: точный месяц отбирается по локальному дню заказа. */
function monthWindow(month: string): { from: string; to: string } {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const start = Date.UTC(y, m - 1, 1);
  const end = Date.UTC(y, m, 1);
  return { from: new Date(start - DAY_MS).toISOString(), to: new Date(end + DAY_MS).toISOString() };
}

/**
 * Заказы магазина с витрины за месяц (постранично, ключ сортировки — id) и
 * возвраты по ним → комиссия месяца. Читает под ролью арендатора (ctx.db).
 * `enabled` передаёт вызывающий: выключатель общий, читается один раз на прогон.
 */
export async function commissionForMonth(
  ctx: TenantContext,
  month: string,
  enabled: boolean,
): Promise<CommissionMonth> {
  const { from, to } = monthWindow(month);
  const tz = ctx.timezone;
  const orders: Array<CommissionOrder & { id: number; refunded?: number }> = [];
  await eachPage(
    (a, b) =>
      ctx.db
        .from("orders")
        .select("id, platform, status, total, paid_amount, fulfillment_kind, currency, created_at")
        .eq("platform", "web")
        .gte("created_at", from)
        .lt("created_at", to)
        .order("created_at")
        .order("id")
        .range(a, b),
    "заказы для комиссии",
    (rows) => {
      for (const o of rows) orders.push({ ...o, day: dayKey(o.created_at, tz) });
    },
  );
  const refunds = await refundsSince(ctx, from);
  for (const o of orders) o.refunded = refunds.get(o.id);
  return monthCommission({
    month,
    orders,
    plan: ctx.tenant.plan,
    enabled,
    start: ctx.tenant.settings.commission?.start,
  });
}
