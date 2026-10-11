import { HelpTip } from "@/app/admin/help-panel";
import { createFileRoute, Link } from "@tanstack/react-router";
import { z } from "zod";
import { analyticsFn } from "@/app/admin/sales-analytics.functions";
import { adminT, intlLocale } from "@/app/i18n/admin";
import { PageTitle } from "@/app/ui";
import { canEdit } from "@/core/auth/roles";
import { BarList, ChartCard, DataTable, LineChart } from "@/app/ui/charts";
import { compactNumber, shortDay } from "@/core/analytics/pure";
import { FUNNEL_STAGES } from "@/core/analytics/funnel";
import { growthFunnel } from "@/core/analytics/growth-funnel";
import { revenueParts } from "@/core/analytics/source-funnel";
import { formatMoney } from "@/core/money/money";
import { ProfitCard } from "@/app/admin/profit-card";
import { OrderStatus } from "./admin._authed.orders";
import { Tile, platformLabel, sourceLabel, SourceLinksCard } from "@/app/admin/analytics/parts";
import { ExplainCard, SpeedCard } from "@/app/admin/analytics/insights";
import { PromoteCard } from "@/app/admin/analytics/promote-card";
import { SalesCard, BundlesCard } from "@/app/admin/analytics/sales-cards";
import { CohortsCard } from "@/app/admin/analytics/cohorts-card";
import { CustomersCard } from "@/app/admin/analytics/customers-card";

const searchSchema = z.object({
  days: z.union([z.literal(7), z.literal(30), z.literal(90)]).catch(30),
});

export const Route = createFileRoute("/admin/_authed/analytics")({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => ({ days: search.days }),
  loader: ({ deps }) => analyticsFn({ data: { days: deps.days } }),
  component: AnalyticsPage,
});

function AnalyticsPage() {
  const a = Route.useLoaderData();
  const visits = a.visits && a.visits !== "failed" ? a.visits : null;
  const funnel = growthFunnel(a.funnel, visits);
  const { days } = Route.useSearch();
  const { shop } = Route.useRouteContext();
  const t = adminT(shop.locale);
  const loc = intlLocale(shop.locale);
  const money = (v: number) => formatMoney(v, a.currency);
  const moneyAll = (revenue: Record<string, number>) =>
    revenueParts(revenue, a.currency)
      .map((p) => formatMoney(p.amount, p.currency))
      .join(" · ");
  const short = (v: number) => compactNumber(v);
  const num = (v: number) => v.toLocaleString(loc);
  const dayLabel = (d: string) =>
    new Date(`${d}T00:00:00`).toLocaleDateString(loc, { day: "numeric", month: "long" });

  return (
    <>
      <PageTitle title={t("analytics.title")} subtitle={t("analytics.subtitle")} />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {([7, 30, 90] as const).map((d) => (
          <Link
            key={d}
            to="/admin/analytics"
            search={{ days: d }}
            className={`rounded-md border px-3 py-1.5 text-sm ${days === d ? "border-accent bg-accent/10 font-medium" : "border-line hover:bg-surface-2"}`}
          >
            {t("analytics.days", { n: d })}
          </Link>
        ))}
        <span className="ml-auto flex flex-wrap items-center gap-2">
          <a
            className="btn-secondary text-sm"
            href={`/api/admin/export/analytics?days=${days}`}
            title={t("analytics.export.hint")}
          >
            {t("analytics.export.daily")}
          </a>
          <a
            className="btn-secondary text-sm"
            href={`/api/admin/export/analytics-products?days=${days}`}
            title={t("analytics.export.hint")}
          >
            {t("analytics.export.products")}
          </a>
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Tile
          label={t("analytics.tile.revenue")}
          value={money(a.current.revenue)}
          delta={a.delta.revenue}
        />
        <Tile
          label={t("analytics.tile.paidOrders")}
          value={a.current.orders.toLocaleString(loc)}
          delta={a.delta.orders}
        />
        <Tile
          label={t("analytics.tile.avgCheck")}
          value={money(a.current.avgCheck)}
          delta={a.delta.avgCheck}
        />
        <Tile
          label={t("analytics.tile.newCustomers")}
          value={a.current.customers.toLocaleString(loc)}
          delta={a.delta.customers}
        />
        <Tile
          label={t("analytics.tile.buyers")}
          value={a.current.buyers.toLocaleString(loc)}
          delta={a.delta.buyers}
        />
      </div>

      {a.byCurrency.some((c) => c.currency !== a.currency) && (
        <p className="mt-3 text-sm text-muted">
          {t("analytics.byCurrency", { currency: formatMoney("", a.currency).trim() })}{" "}
          {a.byCurrency
            .map((c) => {
              const own = `${formatMoney(c.revenue, c.currency)} (${num(c.orders)})`;
              if (c.currency === a.currency) return own;
              return c.inBase == null
                ? `${own} ${t("analytics.byCurrency.noRate")}`
                : `${own} ≈ ${money(c.inBase)}`;
            })
            .join(" · ")}
        </p>
      )}

      {shop.modules.profit && (
        <div className="mt-4">
          <ProfitCard days={days} loc={loc} t={t} />
        </div>
      )}

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        <ChartCard
          className="lg:col-span-2"
          title={
            <span className="flex items-center gap-1.5">
              {t("analytics.funnel.title")}
              <HelpTip article="analytics" anchor="funnel" />
            </span>
          }
          chart={
            <>
              {funnel.empty ? (
                <p className="text-sm text-muted">{t("growth.funnel.empty")}</p>
              ) : (
                <BarList
                  rows={funnel.stages.map((st) => ({
                    label: t(`growth.funnel.${st.key}`),
                    value: st.value,
                    hint:
                      st.rate === null ? undefined : t("analytics.funnel.rate", { pct: st.rate }),
                  }))}
                  format={num}
                  color="var(--chart-2)"
                />
              )}
              <p className="mt-2 text-xs text-muted">{t("analytics.funnel.hint")}</p>
              {visits && <p className="mt-1 text-xs text-muted">{t("growth.visits.note")}</p>}
              {a.visits === "failed" && (
                <p className="mt-1 text-xs text-danger">{t("growth.visits.failed")}</p>
              )}
            </>
          }
          table={
            <DataTable
              head={[
                t("analytics.col.channel"),
                ...FUNNEL_STAGES.map((st) => t(`analytics.funnel.${st}`)),
              ]}
              rows={a.funnel.map((r) => [
                r.channel === "all" ? t("analytics.funnel.all") : platformLabel(r.channel, t),
                ...FUNNEL_STAGES.map((st) => num(r[st])),
              ])}
            />
          }
        />
        {/* Источники — продавцу; бухгалтер получает отчёты, но не их (У5). */}
        {a.sources.length > 0 && (
          <>
            <ChartCard
              className="lg:col-span-2"
              title={
                <span className="flex items-center gap-1.5">
                  {t("analytics.sources.title")}
                  <HelpTip article="analytics" anchor="sources" />
                </span>
              }
              chart={
                <>
                  <BarList
                    rows={a.sources.slice(1).map((r) => ({
                      label: sourceLabel(r.source, t),
                      value: r.ordered,
                      hint: moneyAll(r.revenue),
                    }))}
                    format={num}
                    color="var(--chart-1)"
                  />
                  <p className="mt-2 text-xs text-muted">{t("analytics.sources.hint")}</p>
                  <p className="mt-1 text-xs text-muted">{t("analytics.sources.allNote")}</p>
                </>
              }
              table={
                <DataTable
                  head={[
                    t("analytics.sources.col"),
                    ...(visits ? [t("growth.visits.visit"), t("growth.visits.product")] : []),
                    ...FUNNEL_STAGES.map((st) => t(`analytics.funnel.${st}`)),
                    t("analytics.col.revenue"),
                  ]}
                  rows={a.sources.map((r) => [
                    sourceLabel(r.source, t),
                    ...(visits ? [num(r.visit ?? 0), num(r.product ?? 0)] : []),
                    ...FUNNEL_STAGES.map((st) => num(r[st])),
                    moneyAll(r.revenue),
                  ])}
                />
              }
            />
            <SourceLinksCard bot={a.links.bot} store={a.links.store} />
          </>
        )}
        {canEdit(shop.role) && <ExplainCard days={days} />}
        {a.promote && <PromoteCard hints={a.promote} />}
        <SpeedCard rows={a.speed} />
        {a.sales.length > 0 && <SalesCard sales={a.sales} tz={a.timezone} moneyAll={moneyAll} />}
        {a.giftsBundles && <BundlesCard r={a.giftsBundles} moneyAll={moneyAll} />}
        <CohortsCard cohorts={a.cohorts} />
        <CustomersCard c={a.customers} currencyFallback={a.currency} />
        <ChartCard
          title={t("analytics.chart.revenueByDay")}
          chart={
            <LineChart
              points={a.series.map((p) => ({ x: p.day, y: p.revenue }))}
              format={short}
              labelX={shortDay}
            />
          }
          table={
            <DataTable
              head={[t("analytics.col.day"), t("analytics.col.revenue")]}
              rows={a.series
                .slice()
                .reverse()
                .map((p) => [dayLabel(p.day), money(p.revenue)])}
            />
          }
        />
        <ChartCard
          title={t("analytics.chart.ordersByDay")}
          chart={
            <LineChart
              points={a.series.map((p) => ({ x: p.day, y: p.orders }))}
              format={num}
              labelX={shortDay}
              integer
            />
          }
          table={
            <DataTable
              head={[t("analytics.col.day"), t("analytics.col.orders")]}
              rows={a.series
                .slice()
                .reverse()
                .map((p) => [dayLabel(p.day), p.orders])}
            />
          }
        />
        <ChartCard
          title={t("analytics.chart.customersByDay")}
          chart={
            <LineChart
              points={a.series.map((p) => ({ x: p.day, y: p.customers }))}
              format={num}
              labelX={shortDay}
              color="var(--chart-2)"
              integer
            />
          }
          table={
            <DataTable
              head={[t("analytics.col.day"), t("analytics.col.customers")]}
              rows={a.series
                .slice()
                .reverse()
                .map((p) => [dayLabel(p.day), p.customers])}
            />
          }
        />
        <ChartCard
          title={t("analytics.chart.topProducts")}
          chart={
            <BarList
              rows={a.topProducts.map((tp) => ({
                label: tp.name,
                value: tp.revenue,
                hint: t("analytics.qty", { n: tp.qty }),
              }))}
              format={money}
            />
          }
          table={
            <DataTable
              head={[
                t("analytics.col.product"),
                t("analytics.col.qty"),
                t("analytics.col.orders"),
                t("analytics.col.revenue"),
              ]}
              rows={a.topProducts.map((tp) => [tp.name, tp.qty, tp.orders, money(tp.revenue)])}
            />
          }
        />
        <ChartCard
          title={t("analytics.chart.byChannel")}
          chart={
            <BarList
              rows={a.byPlatform.map((p) => ({
                label: platformLabel(p.platform, t),
                value: p.orders,
                hint: money(p.revenue),
              }))}
              format={num}
            />
          }
          table={
            <DataTable
              head={[
                t("analytics.col.channel"),
                t("analytics.col.orders"),
                t("analytics.col.revenue"),
              ]}
              rows={a.byPlatform.map((p) => [
                platformLabel(p.platform, t),
                p.orders,
                money(p.revenue),
              ])}
            />
          }
        />
        <ChartCard
          title={t("analytics.chart.byStatus")}
          chart={
            <BarList
              rows={a.byStatus.map((s) => ({ label: s.status, value: s.orders }))}
              format={num}
            />
          }
          table={
            <DataTable
              head={[t("analytics.col.status"), t("analytics.col.orders")]}
              rows={a.byStatus.map((s) => [
                <OrderStatus key={s.status} status={s.status} />,
                s.orders,
              ])}
            />
          }
        />
      </div>
    </>
  );
}
