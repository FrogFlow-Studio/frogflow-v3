import { getRouteApi } from "@tanstack/react-router";
import { adminT, intlLocale } from "@/app/i18n/admin";
import { Card } from "@/app/ui";

/** Контекст страницы аналитики: компонент вынесен из файла маршрута. */
const Route = getRouteApi("/admin/_authed/analytics");

/** Когорты покупателей. */

/** Когорты покупателей и повторные покупки (core/analytics/cohorts). */
export function CohortsCard({
  cohorts,
}: {
  cohorts: {
    rows: Array<{ month: string; size: number; retention: number[] }>;
    repeat: { buyers: number; repeat: number; rate: number };
  };
}) {
  const { shop } = Route.useRouteContext();
  const t = adminT(shop.locale);
  const width = Math.max(0, ...cohorts.rows.map((r) => r.retention.length));
  const monthLabel = (m: string) =>
    new Date(`${m}-01T00:00:00Z`).toLocaleDateString(intlLocale(shop.locale), {
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    });
  return (
    <Card title={t("analytics.cohorts.title")} className="lg:col-span-2">
      <p className="mb-3 text-sm">
        {t("analytics.cohorts.repeat", {
          rate: cohorts.repeat.rate,
          repeat: cohorts.repeat.repeat,
          buyers: cohorts.repeat.buyers,
        })}
      </p>
      {cohorts.rows.length === 0 ? (
        <p className="text-sm text-muted">{t("analytics.cohorts.empty")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>{t("analytics.cohorts.month")}</th>
                <th className="text-right">{t("analytics.cohorts.buyers")}</th>
                {Array.from({ length: width }, (_, i) => (
                  <th key={i} className="text-right">
                    +{i + 1}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {cohorts.rows.map((r) => (
                <tr key={r.month}>
                  <td className="whitespace-nowrap">{monthLabel(r.month)}</td>
                  <td className="text-right tabular-nums">{r.size}</td>
                  {Array.from({ length: width }, (_, i) => {
                    const v = r.retention[i];
                    return (
                      <td
                        key={i}
                        className="text-right tabular-nums"
                        style={
                          v === undefined
                            ? undefined
                            : {
                                background: `color-mix(in srgb, var(--chart-1) ${Math.min(v, 60)}%, transparent)`,
                              }
                        }
                      >
                        {v === undefined ? "" : `${v}%`}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-2 text-xs text-muted">{t("analytics.cohorts.hint")}</p>
    </Card>
  );
}
