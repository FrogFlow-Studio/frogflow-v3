import { Link } from "@tanstack/react-router";
import type { AdminT } from "@/app/i18n/admin";
import { Card } from "@/app/ui";
import { formatMoney } from "@/core/money/money";
import type { Growth, Trio } from "@/core/overview/growth";

function Delta({ v, t }: { v: Trio; t: AdminT }) {
  if (v.deltaPct === null)
    return <span className="text-xs text-muted">{t("growth.card.noBase")}</span>;
  if (v.deltaPct === 0) return <span className="text-xs text-muted">{t("growth.card.same")}</span>;
  return (
    <span className={`text-xs font-medium ${v.deltaPct > 0 ? "text-ok" : "text-danger"}`}>
      {t(v.deltaPct > 0 ? "growth.card.up" : "growth.card.down", { n: Math.abs(v.deltaPct) })}
    </span>
  );
}

/** «Рост» (У5): три числа за 30 суток против прежних и ссылка в «Аналитику» (если раздел доступен роли). */
export function GrowthCard({
  growth,
  analytics,
  t,
}: {
  growth: Growth | "failed";
  analytics: boolean;
  t: AdminT;
}) {
  return (
    <Card title={t("growth.card.title")} className="mb-6">
      {growth === "failed" ? (
        <p className="text-sm text-danger">{t("waiting.failed")}</p>
      ) : (
        <>
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-3" data-growth>
            {(
              [
                [
                  "growth.card.revenue",
                  formatMoney(growth.revenue.cur, growth.currency),
                  growth.revenue,
                ],
                ["growth.card.orders", String(growth.orders.cur), growth.orders],
                ["growth.card.buyers", String(growth.buyers.cur), growth.buyers],
              ] as const
            ).map(([label, value, trio]) => (
              <li key={label} className="min-w-0 rounded-md border border-line p-3">
                <div className="truncate text-xs text-muted">{t(label)}</div>
                <div className="text-xl font-semibold tabular-nums">{value}</div>
                <Delta v={trio} t={t} />
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted">{t("growth.card.caption")}</p>
        </>
      )}
      {analytics && (
        <Link
          to="/admin/analytics"
          className="mt-2 inline-block text-sm text-accent hover:underline"
        >
          {t("growth.card.more")} →
        </Link>
      )}
    </Card>
  );
}
