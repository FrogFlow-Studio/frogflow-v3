import type { TenantContext } from "@/core/tenant/resolve.server";
import { tenantContext } from "@/core/tenant/resolve.server";
import type { Tenant } from "@/core/tenant/types";
import { todayInTz } from "@/core/fulfillment/pure";
import {
  digestDue,
  digestSentOn,
  markDigested,
  claimDigestSent,
  releaseDigest,
  queuedDigestItems,
  renderDigest,
  type DigestStats,
} from "@/core/notify/digest";
import { loadNotifyPrefs } from "@/core/notify/prefs";
import { sellerLocaleSafe } from "@/core/ai/seller-text";
import { notifyAdminsHtml } from "./notify";

async function digestStats(ctx: TenantContext): Promise<DigestStats> {
  const { orderCounts, revenue } = await import("@/core/orders/admin");
  const { countUndelivered } = await import("@/core/outbox/outbox");
  const { runningOutNow } = await import("@/core/stock/forecast");
  const [counts, rev, undelivered, soon] = await Promise.all([
    orderCounts(ctx),
    revenue(ctx, 1),
    countUndelivered(ctx).catch(() => 0),
    // Прогноз склада не должен ронять всю сводку: нет данных — строки просто нет.
    runningOutNow(ctx).catch((e) => {
      console.error(`[digest:${ctx.tenant.id}] прогноз склада не прочитан: ${String(e)}`);
      return [];
    }),
  ]);
  return {
    ordersYesterday: rev.orders,
    revenueYesterday: { total: rev.total, currency: rev.currency },
    awaitingConfirmation: counts.awaiting_confirmation ?? 0,
    undelivered,
    runningOut: soon.map((r) => ({ name: r.name, days: r.days })),
  };
}

/** Крон (каждые 15 минут): у кого настал час дайджеста — собрать и отправить. */
export async function sendDueDigests(
  tenants: readonly Tenant[],
  now = new Date(),
): Promise<Record<string, "sent" | "skipped" | string>> {
  const out: Record<string, string> = {};
  for (const t of tenants) {
    if (!t.telegramTokenEnc) continue;
    const ctx = tenantContext(t);
    try {
      const prefs = await loadNotifyPrefs(ctx);
      if (!prefs.digest.enabled) continue;
      const today = todayInTz(ctx.timezone, now);
      if (!digestDue(prefs, now, ctx.timezone, await digestSentOn(ctx), today)) continue;
      // Отметка дня — до отправки, условной записью: второй крон уступает.
      const claim = await claimDigestSent(ctx, today);
      if (!claim.won) continue;
      let sent: number;
      try {
        const items = await queuedDigestItems(ctx);
        const stats = await digestStats(ctx);
        const yesterday = new Date(now.getTime() - 86_400_000).toLocaleDateString("ru-RU", {
          timeZone: ctx.timezone,
          day: "2-digit",
          month: "2-digit",
        });
        sent = await notifyAdminsHtml(
          ctx,
          renderDigest(yesterday, stats, items, await sellerLocaleSafe(ctx)),
          {
            kind: "digest",
          },
        );
        // Сообщение ушло: отметка не должна его откатывать (иначе завтра те же пункты
        // придут второй раз). Один повтор, дальше — в журнал.
        if (sent > 0) {
          const ids = items.map((i) => i.id);
          if ((await markDigested(ctx, ids)) > 0 && (await markDigested(ctx, ids)) > 0)
            console.error(
              `[digest:${ctx.tenant.id}] пункты ушли, но не отмечены — придут повторно`,
            );
        }
      } catch (e) {
        // Не дошло — вернуть отметку: следующий тик повторит, а не потеряет день.
        await releaseDigest(ctx, today, claim.prev);
        throw e;
      }
      out[t.id] = sent > 0 ? "sent" : "skipped";
    } catch (e) {
      out[t.id] = e instanceof Error ? e.message : String(e);
    }
  }
  return out;
}
