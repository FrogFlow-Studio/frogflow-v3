import { createFileRoute, Link, useRouteContext } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { z } from "zod";
import { analyticsFn } from "@/app/admin/admin.functions";
import { explainSalesFn } from "@/app/admin/analytics.functions";
import { adminT, intlLocale, type AdminT } from "@/app/i18n/admin";
import { Badge, Card, ErrorBox, Field, PageTitle, useAction } from "@/app/ui";
import { PROMOTE } from "@/core/analytics/promote";
import { canEdit } from "@/core/auth/roles";
import { BarList, ChartCard, DataTable, LineChart } from "@/app/ui/charts";
import { compactNumber, shortDay } from "@/core/analytics/pure";
import { FUNNEL_STAGES } from "@/core/analytics/funnel";
import { growthFunnel } from "@/core/analytics/growth-funnel";
import { autoShare, type SpeedRow } from "@/core/analytics/speed";
import { revenueParts, SOURCE_TAG_GROUP } from "@/core/analytics/source-funnel";
import {
  botSourceLink,
  SOURCE_TAG_MAX,
  sourceTag,
  storeSourceLink,
} from "@/core/analytics/source-links";
import { formatMoney } from "@/core/money/money";
import { ProfitCard } from "@/app/admin/profit-card";
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
  if (["search", "market", "link"].includes(source))
    return t(`growth.source.${source}` as "growth.source.search");
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

      {a.byCurrency.length > 1 && (
        <p className="mt-3 text-sm text-muted">
          {t("analytics.byCurrency", { currency: a.currency })}{" "}
          {a.byCurrency
            .map((c) => `${formatMoney(c.revenue, c.currency)} (${num(c.orders)})`)
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
          title={t("analytics.funnel.title")}
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

/** Покупатели: новые и вернувшиеся по неделям, топ по сумме, уснувшие (core/analytics/customers). */
function CustomersCard({
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

/** Итоги акций: продажи товаров акции за её срок и за такой же срок до неё (core/analytics/sales). */
function SalesCard({
  sales,
  tz,
  moneyAll,
}: {
  sales: Awaited<ReturnType<typeof analyticsFn>>["sales"];
  tz: string;
  moneyAll: (revenue: Record<string, number>) => string;
}) {
  const { shop } = Route.useRouteContext();
  const t = adminT(shop.locale);
  const loc = intlLocale(shop.locale);
  const date = (iso: string) =>
    new Date(iso).toLocaleDateString(loc, {
      day: "numeric",
      month: "short",
      timeZone: tz,
    });
  const verdict = { up: "ok", flat: undefined, down: "warn", none: undefined } as const;
  return (
    <Card title={t("analytics.sales.title")} className="lg:col-span-2">
      <div className="overflow-x-auto">
        <DataTable
          head={[
            t("analytics.sales.col.offer"),
            t("analytics.sales.col.period"),
            t("analytics.sales.col.orders"),
            t("analytics.sales.col.units"),
            t("analytics.sales.col.revenue"),
            t("analytics.sales.col.verdict"),
          ]}
          rows={sales.map((r) => [
            `${r.name} (−${r.percent}%)`,
            `${date(r.startsAt)} — ${date(r.endsAt)}${r.running ? ` · ${t("analytics.sales.running")}` : ""}`,
            `${r.before.orders} → ${r.during.orders}`,
            `${r.before.units} → ${r.during.units}`,
            `${moneyAll(r.before.revenue) || "0"} → ${moneyAll(r.during.revenue) || "0"}`,
            <Badge key="v" tone={verdict[r.verdict]}>
              {t(`analytics.sales.verdict.${r.verdict}`)}
            </Badge>,
          ])}
        />
      </div>
      <p className="mt-2 text-xs text-muted">{t("analytics.sales.hint")}</p>
    </Card>
  );
}

/** Наборы и подарки: продажи наборов, доля подарочных заказов, выручка упаковки (core/analytics/bundles). */
function BundlesCard({
  r,
  moneyAll,
}: {
  r: NonNullable<Awaited<ReturnType<typeof analyticsFn>>["giftsBundles"]>;
  moneyAll: (revenue: Record<string, number>) => string;
}) {
  const { shop } = Route.useRouteContext();
  const t = adminT(shop.locale);
  const share = r.gifts.orders > 0 ? Math.round((r.gifts.gifts / r.gifts.orders) * 100) : 0;
  return (
    <Card title={t("analytics.bundles.title")} className="lg:col-span-2">
      <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[max-content_1fr]">
        <dt className="text-muted">{t("analytics.bundles.sold")}</dt>
        <dd data-testid="bundles-sold">
          {t("analytics.bundles.soldValue", { units: r.bundles.units, orders: r.bundles.orders })}
        </dd>
        <dt className="text-muted">{t("analytics.bundles.revenue")}</dt>
        <dd data-testid="bundles-revenue">{moneyAll(r.bundles.revenue) || "0"}</dd>
        <dt className="text-muted">{t("analytics.bundles.saved")}</dt>
        <dd data-testid="bundles-saved">{moneyAll(r.bundles.saving) || "0"}</dd>
        <dt className="text-muted">{t("analytics.bundles.gifts")}</dt>
        <dd data-testid="bundles-gifts">
          {t("analytics.bundles.giftsValue", {
            gifts: r.gifts.gifts,
            orders: r.gifts.orders,
            share,
          })}
        </dd>
        <dt className="text-muted">{t("analytics.bundles.wrap")}</dt>
        <dd data-testid="bundles-wrap">
          {t("analytics.bundles.wrapValue", {
            sum: moneyAll(r.gifts.wrapRevenue) || "0",
            orders: r.gifts.wrapOrders,
          })}
        </dd>
      </dl>
      {r.bundles.rows.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <DataTable
            head={[
              t("analytics.bundles.col.name"),
              t("analytics.bundles.col.units"),
              t("analytics.bundles.col.revenue"),
              t("analytics.bundles.col.saved"),
            ]}
            rows={r.bundles.rows
              .slice(0, 10)
              .map((b) => [b.name, String(b.units), moneyAll(b.revenue), moneyAll(b.saving)])}
          />
        </div>
      )}
      <p className="mt-2 text-xs text-muted">{t("analytics.bundles.hint")}</p>
    </Card>
  );
}

/** «Что продвигать» (У4): хорошо оценённые товары, которые редко берут, и товары, которые скоро закончатся. */
function PromoteCard({
  hints,
}: {
  hints: NonNullable<Awaited<ReturnType<typeof analyticsFn>>["promote"]>;
}) {
  const { shop } = Route.useRouteContext();
  const t = adminT(shop.locale);
  const days = PROMOTE.windowDays;
  const link = (id: string, name: string) => (
    <Link to="/admin/products/$id" params={{ id }} className="font-medium hover:underline">
      {name}
    </Link>
  );
  return (
    <Card title={t("growth.promote.title")} className="lg:col-span-2">
      {hints === "failed" ? (
        <p className="text-sm text-danger">{t("growth.promote.failed")}</p>
      ) : hints.quality.length === 0 && hints.stock.length === 0 ? (
        <p className="text-sm text-muted">{t("growth.promote.empty")}</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
          {hints.quality.length > 0 && (
            <div>
              <h3 className="mb-2 text-sm font-medium">{t("growth.promote.quality")}</h3>
              <ul className="space-y-2 text-sm">
                {hints.quality.map((h) => (
                  <li key={h.id}>
                    {link(h.id, h.name)}
                    <span className="block text-muted">
                      {t("growth.promote.qualityItem", {
                        avg: h.avg,
                        count: h.count,
                        days,
                        sold: h.sold,
                      })}
                    </span>
                  </li>
                ))}
              </ul>
              {hints.total.quality > hints.quality.length && (
                <p className="mt-2 text-xs text-muted">
                  {t("growth.promote.more", {
                    shown: hints.quality.length,
                    total: hints.total.quality,
                  })}
                </p>
              )}
            </div>
          )}
          {hints.stock.length > 0 && (
            <div>
              <h3 className="mb-2 text-sm font-medium">{t("growth.promote.stock")}</h3>
              <ul className="space-y-2 text-sm">
                {hints.stock.map((h) => (
                  <li key={h.id}>
                    {link(h.id, h.name)}
                    <span className="block text-muted">
                      {h.stock === 0
                        ? t("growth.promote.stockOut", { days, sold: h.sold })
                        : t("growth.promote.stockItem", {
                            stock: h.stock,
                            days,
                            sold: h.sold,
                            left: h.daysLeft,
                          })}
                    </span>
                  </li>
                ))}
              </ul>
              {hints.total.stock > hints.stock.length && (
                <p className="mt-2 text-xs text-muted">
                  {t("growth.promote.more", {
                    shown: hints.stock.length,
                    total: hints.total.stock,
                  })}
                </p>
              )}
            </div>
          )}
        </div>
      )}
      <p className="mt-3 text-xs text-muted">{t("growth.promote.hint")}</p>
    </Card>
  );
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

/** ИИ-разбор: «Почему изменились продажи». Тратит ИИ-баланс клиента, текст нигде не сохраняется. */
function ExplainCard({ days }: { days: 7 | 30 | 90 }) {
  const { shop } = Route.useRouteContext();
  const t = adminT(shop.locale);
  const [text, setText] = useState("");
  const explain = useAction(async () => {
    const r = await explainSalesFn({ data: { days, lang: shop.locale } });
    setText(r.text);
  });
  return (
    <Card title={t("analytics.explain.title")} className="lg:col-span-2">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="btn-secondary text-sm"
          disabled={explain.busy}
          onClick={() => void explain.run().catch(() => {})}
        >
          {explain.busy ? t("analytics.explain.busy") : t("analytics.explain.button")}
        </button>
        <p className="text-xs text-muted">{t("analytics.explain.hint", { n: days })}</p>
      </div>
      <ErrorBox error={explain.error} />
      {text && <p className="mt-3 whitespace-pre-line text-sm">{text}</p>}
    </Card>
  );
}
