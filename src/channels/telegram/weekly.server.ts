import { tenantContext } from "@/core/tenant/resolve.server";
import type { Tenant } from "@/core/tenant/types";
import { sendWeeklyReport, type WeeklyOutcome } from "@/core/analytics/weekly.server";
import { notifyAdminsHtml } from "./notify";

/**
 * Крон (каждые 15 минут, вместе с дайджестом): недельный отчёт продавцу в
 * бот его магазина. Без бота слать некуда — пропускаем.
 */
export async function sendDueWeeklyReports(
  tenants: readonly Tenant[],
  now = new Date(),
): Promise<Record<string, WeeklyOutcome | string>> {
  const out: Record<string, string> = {};
  for (const t of tenants) {
    if (!t.telegramTokenEnc) continue;
    const ctx = tenantContext(t);
    try {
      const r = await sendWeeklyReport(
        ctx,
        (html) => notifyAdminsHtml(ctx, html, { kind: "digest" }),
        now,
      );
      if (r !== "notDue" && r !== "already") out[t.id] = r;
    } catch (e) {
      out[t.id] = e instanceof Error ? e.message : String(e);
    }
  }
  return out;
}
