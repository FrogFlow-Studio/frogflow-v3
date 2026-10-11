import { HelpTip } from "@/app/admin/help-panel";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { centerReportFn, reportKindsFn } from "@/app/admin/reports.functions";
import { adminT, type AdminKey } from "@/app/i18n/admin";
import { Empty, PageTitle } from "@/app/ui";
import { formatMoney } from "@/core/money/money";
import {
  delta,
  REPORT_KINDS,
  REPORT_PERIODS,
  type Metric,
  type ReportKind,
} from "@/core/reports/center";

type Search = { kind?: ReportKind; days?: (typeof REPORT_PERIODS)[number] };

export const Route = createFileRoute("/admin/_authed/reports")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    kind: REPORT_KINDS.find((k) => k === s.kind),
    days: REPORT_PERIODS.find((d) => d === Number(s.days)),
  }),
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => {
    const kinds = await reportKindsFn();
    const kind = deps.kind && kinds.includes(deps.kind) ? deps.kind : kinds[0]!;
    const days = deps.days ?? 30;
    return { kinds, report: await centerReportFn({ data: { kind, days } }) };
  },
  component: ReportsPage,
});

const value = (m: Metric, n: number) => (m.currency ? formatMoney(n, m.currency) : String(n));

function ReportsPage() {
  const { kinds, report } = Route.useLoaderData();
  const { shop } = Route.useRouteContext();
  const t = adminT(shop.locale);
  const nav = useNavigate({ from: "/admin/reports" });
  const go = (s: Search) => void nav({ search: s });
  return (
    <>
      <style>{`@media print { aside, header { display: none !important; } main { padding: 0 !important; max-width: none !important; } }`}</style>
      <div className="print:hidden">
        <PageTitle
          title={t("reports.title")}
          subtitle={t("reports.subtitle")}
          actions={
            <>
              <a
                className="btn-secondary text-sm"
                href={`/api/admin/reports/${report.kind}?days=${report.days}`}
              >
                {t("reports.csv")}
              </a>
              <button className="btn-secondary text-sm" onClick={() => window.print()}>
                {t("reports.print")}
              </button>
            </>
          }
        />
        <div className="mb-3 flex flex-wrap items-center gap-2" role="tablist">
          <HelpTip article="reports" anchor="kinds" />
          {kinds.map((k) => (
            <button
              key={k}
              role="tab"
              aria-selected={report.kind === k}
              className={`btn-ghost text-sm ${report.kind === k ? "font-medium text-accent" : ""}`}
              onClick={() => go({ kind: k, days: report.days as Search["days"] })}
            >
              {t(`reports.kind.${k}` as AdminKey)}
            </button>
          ))}
        </div>
        <div className="mb-3 flex flex-wrap gap-2">
          {REPORT_PERIODS.map((d) => (
            <button
              key={d}
              className={`btn-ghost text-sm ${report.days === d ? "font-medium text-accent" : ""}`}
              aria-pressed={report.days === d}
              onClick={() => go({ kind: report.kind, days: d })}
            >
              {t("reports.period", { n: d })}
            </button>
          ))}
        </div>
      </div>
      <h2 className="mb-2 hidden text-lg font-medium print:block">
        {t(`reports.kind.${report.kind}` as AdminKey)} · {t("reports.period", { n: report.days })}
      </h2>
      <div className="card mb-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-muted">
              <th className="px-3 py-2">{t("reports.h.metric")}</th>
              <th className="px-3 py-2">{t("reports.h.current")}</th>
              <th className="px-3 py-2">{t("reports.h.previous")}</th>
              <th className="px-3 py-2">{t("reports.h.change")}</th>
            </tr>
          </thead>
          <tbody>
            {report.metrics.map((m) => {
              const d = delta(m);
              return (
                <tr key={m.key} className="border-t border-line">
                  <td className="px-3 py-2">{t(`reports.m.${m.key}` as AdminKey)}</td>
                  <td className="px-3 py-2 font-medium">{value(m, m.current)}</td>
                  <td className="px-3 py-2 text-muted">
                    {m.previous === null ? "—" : value(m, m.previous)}
                  </td>
                  <td className="px-3 py-2">{d === null ? "—" : `${d > 0 ? "+" : ""}${d}%`}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {report.table &&
        (report.table.rows.length === 0 ? (
          <Empty>{t("reports.noData")}</Empty>
        ) : (
          <div className="card mb-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted">
                  {report.table.columns.map((c) => (
                    <th key={c} className="px-3 py-2">
                      {t(`reports.c.${c}` as AdminKey)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {report.table.rows.map((r, i) => (
                  <tr key={i} className="border-t border-line">
                    {r.map((c, j) => (
                      <td key={j} className="px-3 py-2">
                        {c}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      <p className="text-xs text-muted print:hidden">{t("reports.note")}</p>
    </>
  );
}
