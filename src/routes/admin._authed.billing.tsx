import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { billingHistoryFn } from "@/app/admin/plan.functions";
import { adminT, intlLocale, type AdminT } from "@/app/i18n/admin";
import { Badge, Card, ErrorBox, PageTitle, useAction } from "@/app/ui";
import { formatMoney } from "@/core/money/money";
import { HelpTip } from "@/app/admin/help-panel";

export const Route = createFileRoute("/admin/_authed/billing")({
  loader: async () => ({
    payments: await load<Pays>("payments", 0),
    invoices: await load<Invs>("invoices", 0),
  }),
  component: BillingPage,
});

type Loaded = Awaited<ReturnType<typeof billingHistoryFn>>;
type Pays = Extract<Loaded, { kind: "payments" }>;
type Invs = Extract<Loaded, { kind: "invoices" }>;
const load = <T extends Loaded>(kind: T["kind"], page: number) =>
  billingHistoryFn({ data: { kind, page } }) as Promise<T>;

const STATUS_TONE: Record<string, "ok" | "warn" | "danger" | "neutral"> = {
  paid: "ok",
  sent: "warn",
  proof_uploaded: "warn",
  rejected: "danger",
  cancelled: "neutral",
};

function Pager({
  data,
  t,
  go,
  busy,
}: {
  data: Loaded;
  t: AdminT;
  go: (page: number) => void;
  busy: boolean;
}) {
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
  if (pages <= 1) return null;
  return (
    <div className="mt-3 flex items-center justify-between gap-2 text-xs">
      <button
        className="btn-secondary text-xs"
        disabled={busy || data.page === 0}
        onClick={() => go(data.page - 1)}
      >
        {t("billing.prev")}
      </button>
      <span className="text-muted">{t("billing.pageOf", { page: data.page + 1, pages })}</span>
      <button
        className="btn-secondary text-xs"
        disabled={busy || data.page + 1 >= pages}
        onClick={() => go(data.page + 1)}
      >
        {t("billing.next")}
      </button>
    </div>
  );
}

function BillingPage() {
  const first = Route.useLoaderData();
  const { shop } = Route.useRouteContext();
  const t = adminT(shop.locale);
  const loc = intlLocale(shop.locale);
  const day = (iso: string) => new Date(iso).toLocaleDateString(loc);
  const [payments, setPayments] = useState(first.payments);
  const [invoices, setInvoices] = useState(first.invoices);
  const pay = useAction(async (page: number) => setPayments(await load<Pays>("payments", page)));
  const inv = useAction(async (page: number) => setInvoices(await load<Invs>("invoices", page)));
  return (
    <>
      <PageTitle title={t("billing.title")} />
      <Card title={t("billing.payments")} className="mb-4">
        {payments.rows.length === 0 ? (
          <p className="text-sm text-muted">{t("billing.emptyPayments")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>{t("billing.period")}</th>
                  <th className="text-right">{t("billing.amount")}</th>
                  <th>{t("billing.paidAt")}</th>
                </tr>
              </thead>
              <tbody>
                {payments.rows.map((p) => (
                  <tr key={p.id}>
                    <td>
                      {day(p.period_start)} – {day(p.period_end)}
                    </td>
                    <td className="text-right tabular-nums">{formatMoney(p.amount, p.currency)}</td>
                    <td>{day(p.paid_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pager data={payments} t={t} busy={pay.busy} go={(p) => void pay.run(p).catch(() => {})} />
        <ErrorBox error={pay.error} />
      </Card>
      <Card title={t("billing.invoices")} actions={<HelpTip article="billing" anchor="invoices" />}>
        {invoices.rows.length === 0 ? (
          <p className="text-sm text-muted">{t("billing.emptyInvoices")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>{t("billing.issuedAt")}</th>
                  <th className="text-right">{t("billing.amount")}</th>
                  <th>{t("billing.status")}</th>
                </tr>
              </thead>
              <tbody>
                {invoices.rows.map((i) => (
                  <tr key={i.id}>
                    <td>{day(i.created_at)}</td>
                    <td className="text-right tabular-nums">{formatMoney(i.amount, i.currency)}</td>
                    <td>
                      <Badge tone={STATUS_TONE[i.status] ?? "neutral"}>
                        {t(`billing.status.${i.status}` as never)}
                      </Badge>
                      {i.status === "paid" && i.confirmed_at && (
                        <span className="ml-2 text-xs text-muted">{day(i.confirmed_at)}</span>
                      )}
                      {i.status === "rejected" && i.reject_reason && (
                        <div className="text-xs text-muted">
                          {t("billing.reason", { reason: i.reject_reason })}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pager data={invoices} t={t} busy={inv.busy} go={(p) => void inv.run(p).catch(() => {})} />
        <ErrorBox error={inv.error} />
      </Card>
    </>
  );
}
