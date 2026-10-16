import type { TenantContext } from "@/core/tenant/resolve.server";
import { liveAutomationApi, ownsZernioAccount, type AutomationApi } from "./automations.server";

/**
 * Тексты, которые Zernio шлёт в Директ сам по правилам «комментарий →
 * Директ» клиента: первое сообщение и его варианты. Охрана «отвечает
 * менеджер» (manager-guard) не считает их репликой человека. Читается, только
 * когда в хвосте переписки нашлось чужое исходящее. Zernio не ответил — пустой
 * список: тогда остаётся прежнее поведение (пауза), но не молчание из-за сбоя
 * в обе стороны.
 */
export async function zernioScenarioTexts(
  ctx: TenantContext,
  list: AutomationApi["list"] = liveAutomationApi.list,
): Promise<string[]> {
  const z = ctx.tenant.settings.zernio;
  if (!z?.profile_id && !z?.accounts?.length && !z?.account_ids?.length) return [];
  try {
    const all = await list(z.profile_id);
    return all
      .filter((a) => ownsZernioAccount(ctx, a.accountId))
      .flatMap((a) => [a.dmMessage ?? "", ...(a.dmMessageVariations ?? [])])
      .filter((t) => t.trim());
  } catch (e) {
    console.warn(`[zernio] comment rules unavailable for ${ctx.tenant.id}: ${String(e)}`);
    return [];
  }
}
