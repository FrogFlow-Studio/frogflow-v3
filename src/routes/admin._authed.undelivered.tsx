import { HelpTip } from "@/app/admin/help-panel";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { outboxActionFn, undeliveredFn } from "@/app/admin/orders.functions";
import { adminT, intlLocale, type AdminKey } from "@/app/i18n/admin";
import { Badge, Empty, ErrorBox, PageTitle, useAction } from "@/app/ui";

export const Route = createFileRoute("/admin/_authed/undelivered")({
  loader: () => undeliveredFn(),
  component: UndeliveredPage,
});

const KINDS = [
  "customer_notice",
  "admin_notice",
  "delivery_failure",
  "deliver_order",
  "crm_webhook",
] as const;

function UndeliveredPage() {
  const rows = Route.useLoaderData();
  const { shop } = Route.useRouteContext();
  const t = adminT(shop.locale);
  const loc = intlLocale(shop.locale);
  const router = useRouter();
  const act = useAction(async (id: string, action: "retry" | "dismiss") => {
    if (action === "dismiss" && !confirm(t("outbox.dismissConfirm"))) return;
    await outboxActionFn({ data: { id, action } });
    await router.invalidate();
  });
  const fmt = (iso: string) =>
    new Date(iso).toLocaleString(loc, { dateStyle: "short", timeStyle: "short" });
  const kindLabel = (kind: string) =>
    (KINDS as readonly string[]).includes(kind)
      ? t(`outbox.kind.${kind as (typeof KINDS)[number]}` as AdminKey)
      : kind;
  return (
    <>
      <PageTitle title={t("outbox.title")} subtitle={t("outbox.subtitle")} />
      <ErrorBox error={act.error} />
      {rows.length === 0 ? (
        <Empty>{t("outbox.empty")}</Empty>
      ) : (
        <div className="card overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>{t("outbox.col.when")}</th>
                <th>{t("outbox.col.to")}</th>
                <th>{t("outbox.col.what")}</th>
                <th>
                  <span className="flex items-center gap-1.5">
                    {t("outbox.col.state")}
                    <HelpTip article="undelivered" anchor="auto-retry" />
                  </span>
                </th>
                <th className="text-right">
                  <HelpTip article="undelivered" anchor="retry" />
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="whitespace-nowrap text-muted">{fmt(r.createdAt)}</td>
                  <td>
                    {t(`outbox.audience.${r.audience}`)}
                    {r.orderId && (
                      <>
                        {" · "}
                        <Link
                          to="/admin/orders/$id"
                          params={{ id: String(r.orderId) }}
                          className="hover:underline"
                        >
                          {t("outbox.order", { no: r.orderNo ?? r.orderId })}
                        </Link>
                      </>
                    )}
                  </td>
                  <td className="max-w-md">
                    <div>{kindLabel(r.kind)}</div>
                    {r.text && <div className="truncate text-xs text-muted">{r.text}</div>}
                  </td>
                  <td>
                    {r.status === "dead" ? (
                      <Badge tone="danger">{t("outbox.state.dead", { n: r.attempts })}</Badge>
                    ) : r.status === "sending" ? (
                      <Badge tone="accent">{t("outbox.state.sending")}</Badge>
                    ) : (
                      <Badge tone="warn">
                        {t("outbox.state.queued", { when: r.nextAt ? fmt(r.nextAt) : "—" })}
                      </Badge>
                    )}
                    <div className="mt-1 text-xs text-muted">
                      {t("outbox.attempts", { n: r.attempts })}
                      {r.lastError && ` · ${t("outbox.lastError", { error: r.lastError })}`}
                    </div>
                  </td>
                  <td className="whitespace-nowrap text-right">
                    <button
                      className="btn-ghost text-xs"
                      disabled={act.busy}
                      onClick={() => void act.run(r.id, "retry").catch(() => {})}
                    >
                      {t("outbox.retry")}
                    </button>{" "}
                    <button
                      className="btn-ghost text-xs text-danger"
                      disabled={act.busy}
                      onClick={() => void act.run(r.id, "dismiss").catch(() => {})}
                    >
                      {t("outbox.dismiss")}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
