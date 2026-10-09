import { Link, getRouteApi } from "@tanstack/react-router";
import { analyticsFn } from "@/app/admin/sales-analytics.functions";
import { adminT, intlLocale } from "@/app/i18n/admin";
import { Card } from "@/app/ui";
import { DataTable } from "@/app/ui/charts";
import { formatMoney } from "@/core/money/money";

/** Контекст страницы аналитики: компонент вынесен из файла маршрута. */
const Route = getRouteApi("/admin/_authed/analytics");

/** Покупатели: новые и вернувшиеся. */

/** Покупатели: новые и вернувшиеся по неделям, топ по сумме, уснувшие (core/analytics/customers). */
export function CustomersCard({
  c,
  currencyFallback,
}: {
  c: Awaited<ReturnType<typeof analyticsFn>>["customers"];
  currencyFallback: string;
}) {
  const { shop } = Route.useRouteContext();
  const t = adminT(shop.locale);
  const loc = intlLocale(shop.locale);
  const weekLabel = (w: string) =>
    new Date(`${w}T00:00:00Z`).toLocaleDateString(loc, {
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    });
  const money = (v: number) => formatMoney(v, c.currency ?? currencyFallback);
  return (
    <Card title={t("analytics.customers.title")} className="lg:col-span-2">
      <div className="mb-4 border-b border-line pb-4" data-returning>
        <h3 className="mb-2 text-sm font-medium">{t("growth.returning.title")}</h3>
        {c.period.share === null ? (
          <p className="text-sm text-muted">{t("growth.returning.none")}</p>
        ) : (
          <>
            <p className="mb-2 text-sm">
              {t("growth.returning.share", {
                n: c.period.share,
                back: c.period.returning,
                all: c.period.buyers,
              })}
            </p>
            <DataTable
              head={[
                "",
                t("growth.returning.buyers"),
                t("analytics.col.orders"),
                t("growth.returning.avg"),
              ]}
              rows={[
                [t("growth.returning.fresh"), c.period.fresh.buyers, c.period.fresh.orders],
                [t("growth.returning.back"), c.period.back.buyers, c.period.back.orders],
              ].map((r, i) => {
                const g = i === 0 ? c.period.fresh : c.period.back;
                return [
                  ...r,
                  g.avg === null ? "—" : formatMoney(g.avg, c.period.currency ?? currencyFallback),
                ];
              })}
            />
          </>
        )}
        <p className="mt-2 text-xs text-muted">{t("growth.returning.hint")}</p>
      </div>
      <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        <div>
          <h3 className="mb-2 text-sm font-medium">{t("analytics.customers.weeks")}</h3>
          <DataTable
            head={[
              t("analytics.customers.week"),
              t("analytics.customers.fresh"),
              t("analytics.customers.returning"),
            ]}
            rows={c.weeks
              .slice()
              .reverse()
              .map((w) => [weekLabel(w.week), w.fresh, w.returning])}
          />
          <p className="mt-2 text-xs text-muted">{t("analytics.customers.weeksHint")}</p>
        </div>
        <div>
          <h3 className="mb-2 text-sm font-medium">{t("analytics.customers.top")}</h3>
          {c.top.length === 0 ? (
            <p className="text-sm text-muted">{t("analytics.customers.topEmpty")}</p>
          ) : (
            <DataTable
              head={[
                t("analytics.customers.buyer"),
                t("analytics.col.orders"),
                t("analytics.col.revenue"),
              ]}
              rows={c.top.map((b) => [
                <Link key={b.buyer} to="/admin/customers/$key" params={{ key: b.buyer }}>
                  {b.name || b.buyer}
                </Link>,
                b.orders,
                money(b.amount),
              ])}
            />
          )}
          <p className="mt-2 text-xs text-muted">{t("analytics.customers.topHint")}</p>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-3">
        <p className="text-sm">
          {t("analytics.customers.dormant", { n: c.dormant.count, days: c.dormant.days })}
        </p>
        {c.dormant.count > 0 && (
          <Link
            to="/admin/broadcasts"
            search={{ segment: "inactive", days: c.dormant.days, followup: undefined }}
            className="btn-secondary text-sm"
          >
            {t("analytics.customers.broadcast")}
          </Link>
        )}
      </div>
      <p className="mt-2 text-xs text-muted">{t("analytics.customers.dormantHint")}</p>
    </Card>
  );
}
