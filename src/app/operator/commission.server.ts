import { COMMISSION_DEFAULT_START } from "@/core/plans/registry";
import { commissionEnabled, setCommissionEnabled } from "@/core/commission/commission.server";
import { patchTenantSettings, requireTenant } from "@/core/tenant/resolve.server";
import { logEvent } from "./operator.server";

/**
 * Комиссия платформы у оператора: общий выключатель (по умолчанию выкл.,
 * включается по слову Якова) и дата начала у клиента (`settings.commission.start`).
 */
export async function commissionSwitchView(): Promise<{ enabled: boolean; defaultStart: string }> {
  return { enabled: await commissionEnabled(), defaultStart: COMMISSION_DEFAULT_START };
}

export async function switchCommission(enabled: boolean): Promise<{ enabled: boolean }> {
  await setCommissionEnabled(enabled);
  return { enabled };
}

/** Дата начала комиссии клиента; null — вернуть общую дату. Пишется через patchTenantSettings. */
export async function setCommissionStart(
  botId: string,
  start: string | null,
  actor: string,
): Promise<{ start: string | null }> {
  const t = await requireTenant({ by: "id", value: botId });
  const before = t.settings.commission?.start ?? null;
  // Слияние на один уровень: `start: undefined` при записи JSON убирает ключ.
  await patchTenantSettings(botId, { commission: { start: start ?? undefined } });
  if (before !== start)
    await logEvent(botId, "meta", { action: "commission_start", from: before, to: start }, actor);
  return { start };
}
