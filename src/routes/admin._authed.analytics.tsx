import { createFileRoute, Link, useRouteContext } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { z } from "zod";
import { analyticsFn } from "@/app/admin/admin.functions";
import { adminT, intlLocale, type AdminT } from "@/app/i18n/admin";
import { Card, Field, PageTitle } from "@/app/ui";
import { BarList, ChartCard, DataTable, LineChart } from "@/app/ui/charts";
import { compactNumber, shortDay } from "@/core/analytics/pure";
import { FUNNEL_STAGES, stageRate } from "@/core/analytics/funnel";
import { autoShare, type SpeedRow } from "@/core/analytics/speed";
import { revenueParts, SOURCE_TAG_GROUP } from "@/core/analytics/source-funnel";
import {
  botSourceLink,
  SOURCE_TAG_MAX,
  sourceTag,
  storeSourceLink,
} from "@/core/analytics/source-links";
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

/** Подпись группы источника (core/analytics/source-funnel). */
function sourceLabel(source: string, t: AdminT): string {
  if (source === "all") return t("analytics.sources.all");
  if (["direct", "referral", "storefront", "product", "other"].includes(source))
    return t(`analytics.sources.${source}` as "analytics.sources.direct");
  if (source.startsWith(SOURCE_TAG_GROUP))
    return t("analytics.sources.tag", { label: source.slice(SOURCE_TAG_GROUP.length) });
  if (source.startsWith("site:"))
    return t("analytics.sources.site", { label: source.slice("site:".length) });
  return t("analytics.sources.bot", { label: source });
}

/** Строка ссылки: адрес и кнопка «Скопировать». */
function CopyLink({ label, url, t }: { label: string; url: string; t: AdminT }) {
  const [copied, setCopied] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Буфер обмена недоступен (не https, запрет браузера): адрес выделяется для ручного копирования.
      field.current?.focus();
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-20 text-sm text-muted">{label}</span>
      <input
        ref={field}
        className="input min-w-0 flex-1 font-mono text-xs"
        readOnly
        value={url}
        onFocus={(e) => e.currentTarget.select()}
      />
      <button type="button" className="btn-secondary text-xs" onClick={() => void copy()}>
        {copied ? t("analytics.links.copied") : t("analytics.links.copy")}
      </button>
    </div>
  );
}

/**
 * Генератор ссылок с меткой: t.me/<бот>?start=src_<метка> и витрина с
 * ?utm_source=<метка>. Метка разбирается в core/analytics/source-links.
 */
function SourceLinksCard({ bot, store }: { bot: string | null; store: string | null }) {
  const { shop } = useRouteContext({ from: "/admin/_authed" });
  const t = adminT(shop.locale);
  const [input, setInput] = useState("");
  const parsed = sourceTag(input);
  const error =
    !parsed.ok && parsed.reason !== "empty" ? t(`analytics.links.err.${parsed.reason}`) : null;
  return (
    <Card title={t("analytics.links.title")} className="lg:col-span-2">
      <p className="mb-3 text-sm text-muted">{t("analytics.links.intro")}</p>
      <Field label={t("analytics.links.tag")}>
        <input
          className="input w-full max-w-sm"
          name="source-tag"
          maxLength={SOURCE_TAG_MAX * 2}
          placeholder={t("analytics.links.placeholder")}
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
      </Field>
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
      {parsed.ok && (
        <div className="mt-3 space-y-2">
          <p className="text-xs text-muted">{t("analytics.links.result", { tag: parsed.tag })}</p>
          {bot ? (
            <CopyLink label={t("analytics.links.bot")} url={botSourceLink(bot, parsed.tag)} t={t} />
          ) : (
            <p className="text-sm text-muted">{t("analytics.links.noBot")}</p>
          )}
          {store ? (
            <CopyLink
              label={t("analytics.links.store")}
              url={storeSourceLink(store, parsed.tag)}
              t={t}
            />
          ) : (
            <p className="text-sm text-muted">{t("analytics.links.noStore")}</p>
          )}
        </div>
      )}
    </Card>
  );
}

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
          className="lg:col-span-2"
          title={t("analytics.sources.title")}
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
                ...FUNNEL_STAGES.map((st) => t(`analytics.funnel.${st}`)),
                t("analytics.col.revenue"),
              ]}
              rows={a.sources.map((r) => [
                sourceLabel(r.source, t),
                ...FUNNEL_STAGES.map((st) => num(r[st])),
                moneyAll(r.revenue),
              ])}
            />
          }
        />
        <SourceLinksCard bot={a.links.bot} store={a.links.store} />
        <SpeedCard rows={a.speed} />
        <CohortsCard cohorts={a.cohorts} />
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

/** Когорты покупателей и повторные покупки (core/analytics/cohorts). */
function CohortsCard({
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

/** Минуты → «5 мин», «2 ч 10 мин», «1 дн 3 ч». */
function duration(min: number | null, t: AdminT): string {
  if (min === null) return "—";
  const m = Math.round(min);
  if (m < 60) return t("analytics.speed.fmt.m", { n: m });
  if (m < 1440) {
    const h = Math.floor(m / 60);
    const rest = m % 60;
    return [
      t("analytics.speed.fmt.h", { n: h }),
      rest ? t("analytics.speed.fmt.m", { n: rest }) : "",
    ]
      .filter(Boolean)
      .join(" ");
  }
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  return [t("analytics.speed.fmt.d", { n: d }), h ? t("analytics.speed.fmt.h", { n: h }) : ""]
    .filter(Boolean)
    .join(" ");
}

/** Скорость заказа: оплата и выдача по каналам, доля выданных без продавца (core/analytics/speed). */
function SpeedCard({ rows }: { rows: SpeedRow[] }) {
  const { shop } = Route.useRouteContext();
  const t = adminT(shop.locale);
  const all = rows[0]!;
  const share = autoShare(all);
  return (
    <Card title={t("analytics.speed.title")} className="lg:col-span-2">
      {all.placed === 0 ? (
        <p className="text-sm text-muted">{t("analytics.speed.empty")}</p>
      ) : (
        <>
          <p className="mb-3 text-sm">
            {share === null
              ? t("analytics.speed.autoNone")
              : t("analytics.speed.auto", { pct: share, auto: all.auto, delivered: all.delivered })}
          </p>
          <div className="overflow-x-auto">
            <DataTable
              head={[
                t("analytics.col.channel"),
                t("analytics.speed.col.placed"),
                t("analytics.speed.col.payMedian"),
                t("analytics.speed.col.payP90"),
                t("analytics.speed.col.deliverMedian"),
                t("analytics.speed.col.deliverP90"),
                t("analytics.speed.col.auto"),
              ]}
              rows={rows.map((r) => [
                r.channel === "all" ? t("analytics.funnel.all") : platformLabel(r.channel, t),
                r.placed,
                duration(r.pay.median, t),
                duration(r.pay.p90, t),
                duration(r.deliver.median, t),
                duration(r.deliver.p90, t),
                autoShare(r) === null ? "—" : `${autoShare(r)}%`,
              ])}
            />
          </div>
        </>
      )}
      <p className="mt-2 text-xs text-muted">{t("analytics.speed.hint")}</p>
    </Card>
  );
}
