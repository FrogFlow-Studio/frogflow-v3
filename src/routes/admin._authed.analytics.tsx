import { createFileRoute, Link, useRouteContext } from "@tanstack/react-router";
import { z } from "zod";
import { analyticsFn } from "@/app/admin/admin.functions";
import { adminT, intlLocale, type AdminT } from "@/app/i18n/admin";
import { PageTitle } from "@/app/ui";
import { BarList, ChartCard, DataTable, LineChart } from "@/app/ui/charts";
import { compactNumber, shortDay } from "@/core/analytics/pure";
import { FUNNEL_STAGES, stageRate } from "@/core/analytics/funnel";
import { formatMoney } from "@/core/money/money";
import { OrderStatus } from "./admin._authed.orders";

const searchSchema = z.object({
  days: z.union([z.literal(7), z.literal(30), z.literal(90)]).catch(30),
});

export const Route = createFileRoute("/admin/_authed/analytics")({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => ({ days: search.days }),
  loader: ({ deps }) => analyticsFn({ data: { days: deps.days } }),
  component: AnalyticsPage,
});

const PLATFORM: Record<string, string> = {
  telegram: "Telegram",
  instagram: "Instagram",
  whatsapp: "WhatsApp",
};

function platformLabel(platform: string, t: AdminT): string {
  if (platform === "web") return t("analytics.platform.web");
  return PLATFORM[platform] ?? platform;
}

function Delta({ value, upIsGood = true }: { value: number | null; upIsGood?: boolean }) {
  const { shop } = useRouteContext({ from: "/admin/_authed" });
  const t = adminT(shop.locale);
  if (value === null) return <span className="text-muted">{t("analytics.delta.noPrev")}</span>;
  if (value === 0) return <span className="text-muted">{t("analytics.delta.same")}</span>;
  const good = value > 0 === upIsGood;
  return (
    <span className={good ? "text-ok" : "text-danger"}>
      {value > 0 ? "▲" : "▼"}{" "}
      {t("analytics.delta.vsPrev", {
        pct: Math.abs(value).toLocaleString(intlLocale(shop.locale)),
      })}
    </span>
  );
}

function Tile({ label, value, delta }: { label: string; value: string; delta: number | null }) {
  return (
    <div className="card p-4">
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
      <div className="mt-1 text-xs">
        <Delta value={delta} />
      </div>
    </div>
  );
}

function AnalyticsPage() {
  const a = Route.useLoaderData();
  const { days } = Route.useSearch();
  const { shop } = Route.useRouteContext();
  const t = adminT(shop.locale);
  const loc = intlLocale(shop.locale);
  const money = (v: number) => formatMoney(v, a.currency);
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

      {a.byCurrency.length > 1 && (
        <p className="mt-3 text-sm text-muted">
          {t("analytics.byCurrency", { currency: a.currency })}{" "}
          {a.byCurrency
            .map((c) => `${formatMoney(c.revenue, c.currency)} (${num(c.orders)})`)
            .join(" · ")}
        </p>
      )}

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <ChartCard
          className="lg:col-span-2"
          title={t("analytics.funnel.title")}
          chart={
            <>
              <BarList
                rows={FUNNEL_STAGES.map((st, i) => {
                  const all = a.funnel[0]!;
                  const rate = i ? stageRate(all[FUNNEL_STAGES[i - 1]!], all[st]) : null;
                  return {
                    label: t(`analytics.funnel.${st}`),
                    value: all[st],
                    hint: rate === null ? undefined : t("analytics.funnel.rate", { pct: rate }),
                  };
                })}
                format={num}
                color="var(--chart-2)"
              />
              <p className="mt-2 text-xs text-muted">{t("analytics.funnel.hint")}</p>
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
