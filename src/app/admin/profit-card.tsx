import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { profitFn } from "@/app/admin/cost.functions";
import type { AdminT } from "@/app/i18n/admin";
import { Card, ErrorBox } from "@/app/ui";
import { DataTable } from "@/app/ui/charts";
import { formatMoney } from "@/core/money/money";
import type { ProfitReport } from "@/core/profit/report";

const PREVIEW_ROWS = 10;

const pct = (v: number | null, loc: string) =>
  v === null ? "—" : `${(v * 100).toLocaleString(loc, { maximumFractionDigits: 1 })}%`;

/** «Прибыль» в аналитике: выручка, себестоимость проданного, валовая прибыль и маржа за период. */
export function ProfitCard({ days, loc, t }: { days: 7 | 30 | 90; loc: string; t: AdminT }) {
  const [rep, setRep] = useState<ProfitReport | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [all, setAll] = useState(false);
  useEffect(() => {
    setRep(null);
    setError(null);
    profitFn({ data: { days } }).then(setRep, setError);
  }, [days]);
  if (error) return <ErrorBox error={error} />;
  if (!rep)
    return (
      <Card title={t("profit.title")}>
        <p className="text-sm text-muted">{t("profit.loading")}</p>
      </Card>
    );
  const money = (v: number) => formatMoney(v, rep.currency);
  const rows = all ? rep.products : rep.products.slice(0, PREVIEW_ROWS);
  return (
    <Card title={t("profit.title")}>
      {rep.orders === 0 && rep.unknown.revenue === 0 ? (
        <p className="text-sm text-muted">{t("profit.empty")}</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label={t("profit.revenue")} value={money(rep.revenue)} />
            <Stat label={t("profit.cost")} value={money(rep.cost)} />
            <Stat label={t("profit.profit")} value={money(rep.profit)} />
            <Stat label={t("profit.margin")} value={pct(rep.margin, loc)} />
          </div>
          {rep.unknown.items > 0 || rep.unknown.revenue > 0 ? (
            <p className="mt-3 text-sm text-warn">
              {t("profit.unknown", {
                n: rep.unknown.items,
                sum: money(rep.unknown.revenue),
              })}{" "}
              <Link to="/admin/cost" className="underline">
                {t("profit.setCosts")}
              </Link>
            </p>
          ) : null}
          {rep.fromCurrent.items > 0 && (
            <p className="mt-2 text-xs text-muted">
              {t("profit.fromCurrent", { n: rep.fromCurrent.items })}
            </p>
          )}
          {rep.otherCurrencies.length > 0 && (
            <p className="mt-2 text-xs text-muted">
              {t("profit.other", {
                cur: rep.currency,
                list: rep.otherCurrencies
                  .map((c) => `${formatMoney(c.revenue, c.currency)} (${c.orders})`)
                  .join(" · "),
              })}
            </p>
          )}
          <p className="mt-2 text-xs text-muted">{t("profit.hint")}</p>
          <a
            className="btn-secondary mt-3 inline-block text-sm"
            href={`/api/admin/export/profit?days=${days}`}
          >
            {t("profit.export")}
          </a>
          {rep.products.length > 0 && (
            <div className="mt-4 overflow-x-auto">
              <h3 className="mb-2 text-sm font-medium">{t("profit.products")}</h3>
              <DataTable
                head={[
                  t("profit.col.product"),
                  t("profit.col.qty"),
                  t("profit.col.revenue"),
                  t("profit.col.cost"),
                  t("profit.col.profit"),
                  t("profit.col.margin"),
                ]}
                rows={rows.map((p) => {
                  const knownRevenue = p.revenue - p.unknownRevenue;
                  const none = p.unknownQty >= p.qty;
                  return [
                    <span key="n">
                      {p.name}
                      {p.unknownQty > 0 && (
                        <span className="ml-2 text-xs text-warn">
                          {none ? t("profit.noCost") : t("profit.partNoCost", { n: p.unknownQty })}
                        </span>
                      )}
                    </span>,
                    p.qty.toLocaleString(loc),
                    money(p.revenue),
                    none ? "—" : money(p.cost),
                    none ? "—" : money(p.profit),
                    none ? "—" : pct(knownRevenue > 0 ? p.profit / knownRevenue : null, loc),
                  ];
                })}
              />
              {!all && rep.products.length > PREVIEW_ROWS && (
                <button className="btn-secondary mt-2 text-sm" onClick={() => setAll(true)}>
                  {t("profit.showAll", { n: rep.products.length })}
                </button>
              )}
            </div>
          )}
        </>
      )}
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-muted">{label}</div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}
