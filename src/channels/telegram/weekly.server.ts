import { tenantContext } from "@/core/tenant/resolve.server";
import type { Tenant } from "@/core/tenant/types";
import { servedByV2 } from "@/core/tenant/directory";
import {
  sendWeeklyReport,
  WeeklySendError,
  type WeeklyOutcome,
} from "@/core/analytics/weekly.server";
import { reportError } from "@/lib/errors";
import { adminTelegramApi, notifyAdminsHtml } from "./notify";

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
    // Клиент прежней платформы сводку от v2 не получает (крон и так даёт только v2, это второй замок).
    if (!servedByV2(t)) continue;
    if (!t.telegramTokenEnc) continue;
    const ctx = tenantContext(t);
    try {
      const r = await sendWeeklyReport(
        ctx,
        (html) => notifyAdminsHtml(ctx, html, { kind: "digest" }),
        now,
        {
          // Токен не расшифровывается или его нет — постоянный отказ по типу:
          // неделя отмечается сразу, без подсчёта и повторов каждые 15 минут.
          ready: () => {
            if (!adminTelegramApi(ctx)) throw new Error("нет токена бота");
          },
        },
      );
      if (r !== "notDue" && r !== "already") out[t.id] = r;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (e instanceof WeeklySendError && e.permanent) {
        // Бот заблокирован продавцом или токен неверный: одна запись в журнал,
        // повторов нет (отметка недели остаётся).
        console.warn(`[cron:weekly][${t.id}] отчёт не доставлен: ${message}`);
        out[t.id] = `blocked: ${message}`;
      } else {
        // Отметка недели снята — следующий прогон попробует снова.
        await reportError(e, { where: "cron:weekly", botId: t.id });
        out[t.id] = message;
      }
    }
  }
  return out;
}
