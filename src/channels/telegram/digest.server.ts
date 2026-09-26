import type { TenantContext } from "@/core/tenant/resolve.server";
import { tenantContext } from "@/core/tenant/resolve.server";
import type { Tenant } from "@/core/tenant/types";
import { todayInTz } from "@/core/fulfillment/pure";
import {
  digestDue,
  digestSentOn,
  markDigested,
  markDigestSent,
  queuedDigestItems,
  renderDigest,
  type DigestStats,
} from "@/core/notify/digest";
import { loadNotifyPrefs } from "@/core/notify/prefs";
import { notifyAdminsHtml } from "./notify";

async function digestStats(ctx: TenantContext): Promise<DigestStats> {
  const { orderCounts, revenue } = await import("@/core/orders/admin");
  const { countUndelivered } = await import("@/core/outbox/outbox");
  const [counts, rev, undelivered] = await Promise.all([
    orderCounts(ctx),
    revenue(ctx, 1),
    countUndelivered(ctx).catch(() => 0),
  ]);
  return {
    ordersYesterday: rev.orders,
    revenueYesterday: { total: rev.total, currency: rev.currency },
    awaitingConfirmation: counts.awaiting_confirmation ?? 0,
    undelivered,
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
      const items = await queuedDigestItems(ctx);
      const stats = await digestStats(ctx);
      const yesterday = new Date(now.getTime() - 86_400_000).toLocaleDateString("ru-RU", {
        timeZone: ctx.timezone,
        day: "2-digit",
        month: "2-digit",
      });
      const sent = await notifyAdminsHtml(ctx, renderDigest(yesterday, stats, items), {
        kind: "digest",
      });
      await markDigestSent(ctx, today);
      if (sent > 0)
        await markDigested(
          ctx,
          items.map((i) => i.id),
        );
      out[t.id] = sent > 0 ? "sent" : "skipped";
    } catch (e) {
      out[t.id] = e instanceof Error ? e.message : String(e);
    }
  }
  return out;
}
