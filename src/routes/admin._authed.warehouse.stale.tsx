import { canEdit } from "@/core/auth/roles";
import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { staleFn } from "@/app/admin/stock-reports.functions";
import { adminT } from "@/app/i18n/admin";
import { Card, Empty, PageTitle } from "@/app/ui";
import { formatMoney } from "@/core/money/money";
import { STALE_DEFAULT_DAYS, STALE_OFFER_MAX } from "@/core/stock/stale-const";

const PAGE = 50;

export const Route = createFileRoute("/admin/_authed/warehouse/stale")({
  validateSearch: (s: Record<string, unknown>): { days?: number } => {
    const n = Number(s.days);
    return { days: Number.isInteger(n) && n >= 7 && n <= 365 ? n : undefined };
  },
  beforeLoad: ({ context }) => {
    if (!context.shop.modules.warehouse) throw redirect({ to: "/admin" });
  },
  loaderDeps: ({ search }) => ({ days: search.days }),
  loader: ({ deps }) => staleFn({ data: { days: deps.days } }),
  component: StalePage,
});

function StalePage() {
  const report = Route.useLoaderData();
  const { shop } = Route.useRouteContext();
  const t = adminT(shop.locale);
  const navigate = useNavigate();
  const [shown, setShown] = useState(PAGE);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [daysInput, setDaysInput] = useState(String(report.days));
  const canOffer = Boolean(shop.modules.limited_offers) && canEdit(shop.role);
  const toggle = (id: string, on: boolean) =>
    setPicked((p) => {
      const n = new Set(p);
      if (on) n.add(id);
      else n.delete(id);
      return n;
    });
  const ids = [...picked].slice(0, STALE_OFFER_MAX);
  return (
    <>
      <PageTitle
        title={t("stale.title")}
        subtitle={t("stale.subtitle", { days: report.days })}
        actions={
          <Link to="/admin/warehouse" className="btn-ghost">
            {t("warehouse.back")}
          </Link>
        }
      />
      <Card title={t("stale.params")}>
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            const n = Number(daysInput);
            if (Number.isInteger(n) && n >= 7 && n <= 365)
              void navigate({ to: "/admin/warehouse/stale", search: { days: n } });
          }}
        >
          <label className="text-sm">
            {t("stale.days")}
            <input
              className="input ml-2 w-24"
              type="number"
              min={7}
              max={365}
              value={daysInput}
              onChange={(e) => setDaysInput(e.target.value)}
            />
          </label>
          <button className="btn-secondary">{t("stale.apply")}</button>
          {report.days !== STALE_DEFAULT_DAYS && (
            <span className="text-xs text-muted">
              {t("stale.defaultHint", { days: STALE_DEFAULT_DAYS })}
            </span>
          )}
        </form>
        <p className="mt-3 text-sm">
          {t("stale.total", {
            n: report.products.length,
            sum: formatMoney(report.frozenTotal, report.currency),
          })}
        </p>
        {report.unknownCost > 0 && (
          <p className="text-xs text-muted">{t("stale.unknownCost", { n: report.unknownCost })}</p>
        )}
      </Card>
      {report.products.length === 0 ? (
        <Empty>{t("stale.empty", { days: report.days })}</Empty>
      ) : (
        <div className="mt-4 rounded-lg border border-line bg-surface">
          {canOffer && (
            <div className="flex flex-wrap items-center gap-3 border-b border-line p-3">
              <button
                className="btn-primary"
                disabled={picked.size === 0}
                onClick={() =>
                  void navigate({
                    to: "/admin/discounts",
                    search: { offerProducts: ids.join(",") },
                  })
                }
              >
                {t("stale.createOffer")}
              </button>
              <span className="text-sm text-muted">
                {picked.size > STALE_OFFER_MAX
                  ? t("stale.pickedMax", { max: STALE_OFFER_MAX })
                  : t("stale.picked", { n: picked.size })}
              </span>
            </div>
          )}
          <table className="table">
            <thead>
              <tr>
                {canOffer && <th className="w-8"></th>}
                <th>{t("stale.col.name")}</th>
                <th className="text-right">{t("stale.col.stock")}</th>
                <th className="text-right">{t("stale.col.unitCost")}</th>
                <th className="text-right">{t("stale.col.frozen")}</th>
              </tr>
            </thead>
            <tbody>
              {report.products.slice(0, shown).map((p) => (
                <tr key={p.id}>
                  {canOffer && (
                    <td>
                      <input
                        type="checkbox"
                        aria-label={t("stale.pick", { name: p.name })}
                        checked={picked.has(p.id)}
                        onChange={(e) => toggle(p.id, e.target.checked)}
                      />
                    </td>
                  )}
                  <td>
                    <Link
                      to="/admin/products/$id"
                      params={{ id: p.id }}
                      className="font-medium hover:underline"
                    >
                      {p.name}
                    </Link>
                  </td>
                  <td className="text-right tabular-nums">{p.stock}</td>
                  <td className="text-right tabular-nums">
                    {p.unitCost === null ? "—" : formatMoney(p.unitCost, report.currency)}
                  </td>
                  <td className="text-right tabular-nums">
                    {p.frozen === null ? "—" : formatMoney(p.frozen, report.currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {shown < report.products.length && (
            <div className="flex items-center gap-3 border-t border-line p-3">
              <span className="text-sm text-muted">
                {t("products.shown", { n: shown, total: report.products.length })}
              </span>
              <button className="btn-secondary" onClick={() => setShown(shown + PAGE)}>
                {t("products.showMore")}
              </button>
            </div>
          )}
        </div>
      )}
    </>
  );
}
