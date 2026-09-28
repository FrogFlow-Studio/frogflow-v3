import { serviceDb } from "@/core/db/client.server";
import { servedByV2 } from "@/core/tenant/directory";
import { requireTenant, tenantContext } from "@/core/tenant/resolve.server";
import { AI_MARKUP_MAX, AI_START_USD } from "@/core/ai/pure";
import { serverFailure } from "@/lib/server-failure";
import { shownError } from "@/lib/shown-error";

/**
 * ИИ-баланс клиента глазами оператора: сумма, журнал, ручная поправка с
 * записью в журнал и общая наценка на цену API (core/ai/balance).
 */
const ctxOf = async (botId: string) =>
  tenantContext(await requireTenant({ by: "id", value: botId }));

export async function aiBalanceView(botId: string) {
  const { aiBalancePeek, aiJournal } = await import("@/core/ai/balance");
  const ctx = await ctxOf(botId);
  const [balance, journal] = await Promise.all([aiBalancePeek(ctx), aiJournal(ctx, 30)]);
  return { balance, journal, startUsd: AI_START_USD };
}

/**
 * Ручная поправка оператора. Клиент прежней платформы v2 не трогает
 * (правило 6): его ИИ-баланс появится, когда оператор переключит served_by.
 * Причина обязательна — поправка видна продавцу в журнале.
 */
export async function adjustAiBalance(botId: string, usd: number, note: string, actor: string) {
  const reason = note.trim();
  if (!reason) throw shownError("Напишите причину поправки — её увидит продавец в журнале.");
  const ctx = await ctxOf(botId);
  if (!servedByV2(ctx.tenant))
    throw shownError(
      "Клиент ещё на прежней платформе: ИИ-баланс меняется после переключения на v2.",
    );
  const { aiCredit } = await import("@/core/ai/balance");
  const after = await aiCredit(ctx, { kind: "adjust", usd, note: reason, actor });
  if (!after) throw shownError("Поправка не записана: списать больше остатка нельзя.");
  return after;
}

export async function getAiMarkup(): Promise<number> {
  const { AI_MARKUP_KEY } = await import("@/core/ai/markup");
  const { data } = await serviceDb()
    .from("operator_settings")
    .select("value")
    .eq("key", AI_MARKUP_KEY)
    .maybeSingle();
  const n = Number(data?.value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export async function setAiMarkup(percent: number): Promise<void> {
  if (!Number.isFinite(percent) || percent < 0 || percent > AI_MARKUP_MAX)
    throw shownError(`Наценка — от 0 до ${AI_MARKUP_MAX} %.`);
  const { AI_MARKUP_KEY, resetAiMarkupCache } = await import("@/core/ai/markup");
  const db = serviceDb();
  const value = String(Math.round(percent * 100) / 100);
  const { data } = await db
    .from("operator_settings")
    .select("key")
    .eq("key", AI_MARKUP_KEY)
    .maybeSingle();
  const { error } = data
    ? await db.from("operator_settings").update({ value }).eq("key", AI_MARKUP_KEY)
    : await db.from("operator_settings").insert({ key: AI_MARKUP_KEY, value });
  if (error) throw serverFailure(`Не удалось сохранить наценку: ${error.message}`);
  resetAiMarkupCache();
}
