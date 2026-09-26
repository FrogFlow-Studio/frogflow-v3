import { createFileRoute } from "@tanstack/react-router";
import { shopAuditFn } from "@/app/admin/audit.functions";
import { auditActionLabel, auditDetailsText } from "@/app/admin/audit-labels";
import { adminT, intlLocale } from "@/app/i18n/admin";
import { Empty, PageTitle } from "@/app/ui";

export const Route = createFileRoute("/admin/_authed/log")({
  loader: () => shopAuditFn(),
  component: AuditPage,
});

/** Журнал действий команды магазина — кто что поменял (только владельцу). */
function AuditPage() {
  const rows = Route.useLoaderData();
  const { shop } = Route.useRouteContext();
  const t = adminT(shop.locale);
  const loc = intlLocale(shop.locale);
  const fmt = (iso: string) =>
    new Date(iso).toLocaleString(loc, { dateStyle: "short", timeStyle: "short" });
  return (
    <>
      <PageTitle title={t("audit.title")} subtitle={t("audit.subtitle")} />
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
