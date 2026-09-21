import { createFileRoute, Link } from "@tanstack/react-router";
import { z } from "zod";
import { analyticsFn } from "@/app/admin/admin.functions";
import { PageTitle } from "@/app/ui";
import { BarList, ChartCard, DataTable, LineChart } from "@/app/ui/charts";
import { compactNumber, shortDay } from "@/core/analytics/pure";
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
  web: "Витрина",
  instagram: "Instagram",
  whatsapp: "WhatsApp",
};

function Delta({ value, upIsGood = true }: { value: number | null; upIsGood?: boolean }) {
  if (value === null) return <span className="text-muted">нет данных за прошлый период</span>;
  if (value === 0) return <span className="text-muted">без изменений</span>;
  const good = value > 0 === upIsGood;
  return (
    <span className={good ? "text-ok" : "text-danger"}>
      {value > 0 ? "▲" : "▼"} {Math.abs(value).toLocaleString("ru")} % к прошлому периоду
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
  const money = (v: number) => formatMoney(v, a.currency);
  const short = (v: number) => compactNumber(v);
  const dayLabel = (d: string) =>
    new Date(`${d}T00:00:00`).toLocaleDateString("ru", { day: "numeric", month: "long" });

  return (
    <>
      <PageTitle
        title="Аналитика"
        subtitle="Оплаченные заказы: выданные цифровые и физические с принятым задатком. Сравнение — с таким же периодом до этого."
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {([7, 30, 90] as const).map((d) => (
          <Link
            key={d}
            to="/admin/analytics"
            search={{ days: d }}
            className={`rounded-md border px-3 py-1.5 text-sm ${days === d ? "border-accent bg-accent/10 font-medium" : "border-line hover:bg-surface-2"}`}
          >
            {d} дней
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Tile label="Выручка" value={money(a.current.revenue)} delta={a.delta.revenue} />
        <Tile
          label="Оплаченных заказов"
          value={a.current.orders.toLocaleString("ru")}
          delta={a.delta.orders}
        />
        <Tile label="Средний чек" value={money(a.current.avgCheck)} delta={a.delta.avgCheck} />
        <Tile
          label="Новых покупателей"
          value={a.current.customers.toLocaleString("ru")}
          delta={a.delta.customers}
        />
        <Tile
          label="Платили"
          value={a.current.buyers.toLocaleString("ru")}
          delta={a.delta.buyers}
        />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <ChartCard
          title="Выручка по дням"
          chart={
            <LineChart
              points={a.series.map((p) => ({ x: p.day, y: p.revenue }))}
              format={short}
              labelX={shortDay}
            />
          }
          table={
            <DataTable
              head={["День", "Выручка"]}
              rows={a.series
                .slice()
                .reverse()
                .map((p) => [dayLabel(p.day), money(p.revenue)])}
            />
          }
        />
        <ChartCard
          title="Оплаченные заказы по дням"
          chart={
            <LineChart
              points={a.series.map((p) => ({ x: p.day, y: p.orders }))}
              format={(v) => v.toLocaleString("ru")}
              labelX={shortDay}
              integer
            />
          }
          table={
            <DataTable
              head={["День", "Заказов"]}
              rows={a.series
                .slice()
                .reverse()
                .map((p) => [dayLabel(p.day), p.orders])}
            />
          }
        />
        <ChartCard
          title="Новые покупатели по дням"
          chart={
            <LineChart
              points={a.series.map((p) => ({ x: p.day, y: p.customers }))}
              format={(v) => v.toLocaleString("ru")}
              labelX={shortDay}
              color="var(--chart-2)"
              integer
            />
          }
          table={
            <DataTable
              head={["День", "Покупателей"]}
              rows={a.series
                .slice()
                .reverse()
                .map((p) => [dayLabel(p.day), p.customers])}
            />
          }
        />
        <ChartCard
          title="Топ товаров по выручке"
          chart={
            <BarList
              rows={a.topProducts.map((t) => ({
                label: t.name,
                value: t.revenue,
                hint: `${t.qty} шт.`,
              }))}
              format={money}
            />
          }
          table={
            <DataTable
              head={["Товар", "Штук", "Заказов", "Выручка"]}
              rows={a.topProducts.map((t) => [t.name, t.qty, t.orders, money(t.revenue)])}
            />
          }
        />
        <ChartCard
          title="Заказы по каналам"
          chart={
            <BarList
              rows={a.byPlatform.map((p) => ({
                label: PLATFORM[p.platform] ?? p.platform,
                value: p.orders,
                hint: money(p.revenue),
              }))}
              format={(v) => v.toLocaleString("ru")}
            />
          }
          table={
            <DataTable
              head={["Канал", "Заказов", "Выручка"]}
              rows={a.byPlatform.map((p) => [
                PLATFORM[p.platform] ?? p.platform,
                p.orders,
                money(p.revenue),
              ])}
            />
          }
        />
        <ChartCard
          title="Все заказы периода по статусам"
          chart={
            <BarList
              rows={a.byStatus.map((s) => ({ label: s.status, value: s.orders }))}
              format={(v) => v.toLocaleString("ru")}
            />
          }
          table={
            <DataTable
              head={["Статус", "Заказов"]}
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
