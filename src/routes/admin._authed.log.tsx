import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { shopAuditFn } from "@/app/admin/audit.functions";
import { auditActionLabel, auditDetailsText } from "@/app/admin/audit-labels";
import { adminT, intlLocale } from "@/app/i18n/admin";
import { Empty, PageTitle } from "@/app/ui";

export const Route = createFileRoute("/admin/_authed/log")({
  validateSearch: z.object({ who: z.string().optional() }),
  loaderDeps: ({ search }) => ({ who: search.who }),
  loader: ({ deps }) => shopAuditFn({ data: { who: deps.who } }),
  component: AuditPage,
});

/** Журнал действий команды магазина — кто что поменял (только владельцу). */
function AuditPage() {
  const { rows, people } = Route.useLoaderData();
  const { who } = Route.useSearch();
  const navigate = useNavigate();
  const { shop } = Route.useRouteContext();
  const t = adminT(shop.locale);
  const loc = intlLocale(shop.locale);
  const fmt = (iso: string) =>
    new Date(iso).toLocaleString(loc, { dateStyle: "short", timeStyle: "short" });
  return (
    <>
      <PageTitle title={t("audit.title")} subtitle={t("audit.subtitle")} />
      <label className="mb-3 flex items-center gap-2 text-sm">
        <span className="text-muted">{t("audit.filter.who")}</span>
        <select
          className="input h-9 w-auto"
          value={who ?? ""}
          onChange={(e) =>
            void navigate({ to: "/admin/log", search: { who: e.target.value || undefined } })
          }
        >
          <option value="">{t("audit.filter.all")}</option>
          {people.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </label>
      {rows.length === 0 ? (
        <Empty>{t("audit.empty")}</Empty>
      ) : (
        <div className="card overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>{t("audit.col.when")}</th>
                <th>{t("audit.col.who")}</th>
                <th>{t("audit.col.what")}</th>
                <th>{t("audit.col.details")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const details = auditDetailsText(r.details);
                return (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap text-muted">{fmt(r.at)}</td>
                    <td>{r.who}</td>
                    <td>{auditActionLabel(shop.locale, r.action)}</td>
                    <td className="max-w-md truncate text-xs text-muted" title={details}>
                      {details}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
