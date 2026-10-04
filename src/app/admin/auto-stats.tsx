import type { AdminT } from "@/app/i18n/admin";
import { formatMoney } from "@/core/money/money";
import type { AutoStats } from "@/core/automsg/stats";

/** Итоги автосообщения за 30 дней: отправлено, заказали, выручка (по валютам). */
export function AutoStatsBlock({ t, stats }: { t: AdminT; stats: AutoStats | undefined }) {
  if (!stats) return null;
  const money =
    Object.entries(stats.revenue)
      .map(([cur, sum]) => formatMoney(sum, cur))
      .join(", ") || "0";
  return (
    <div className="mt-3 rounded-lg border border-line p-2 text-xs" data-testid="auto-stats">
      <p className="font-medium">{t("autostats.title")}</p>
      <p className="mt-1 tabular-nums">
        {t("autostats.sent", { sent: stats.sent, failed: stats.failed })}
      </p>
      <p className="tabular-nums">
        {t("autostats.buyers", { buyers: stats.buyers, paid: stats.paid })}
      </p>
      <p className="tabular-nums">{t("autostats.revenue", { money })}</p>
      {stats.returned > 0 && (
        <p className="tabular-nums">{t("autostats.returned", { n: stats.returned })}</p>
      )}
      <p className="mt-1 text-muted">{t("autostats.hint")}</p>
    </div>
  );
}
