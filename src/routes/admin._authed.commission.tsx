import { createFileRoute } from "@tanstack/react-router";
import { commissionPageFn } from "@/app/admin/admin.functions";
import { adminT, intlLocale, type AdminT } from "@/app/i18n/admin";
import { Badge, Card, PageTitle } from "@/app/ui";
import { formatMoney } from "@/core/money/money";
import { COMMISSION_CURRENCY, TIER_TITLES } from "@/core/plans/registry";

export const Route = createFileRoute("/admin/_authed/commission")({
  loader: async () => commissionPageFn(),
  component: CommissionPage,
});

type Page = Awaited<ReturnType<typeof commissionPageFn>>;
const money = (n: number) => formatMoney(n, COMMISSION_CURRENCY);

function MonthCard({ title, m, t }: { title: string; m: Page["current"]; t: AdminT }) {
  return (
    <Card
      title={title}
      actions={m.accrues ? undefined : <Badge>{t("commission.notAccrued")}</Badge>}
    >
      <dl className="space-y-1 text-sm">
        <div className="flex justify-between gap-3">
          <dt className="text-muted">{t("commission.sales")}</dt>
          <dd className="tabular-nums">{money(m.sales)}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted">{t("commission.orders")}</dt>
          <dd className="tabular-nums">{m.orders}</dd>
        </div>
        {m.rate !== null && (
          <>
            <div className="flex justify-between gap-3">
              <dt className="text-muted">{t("commission.free")}</dt>
              <dd className="tabular-nums">{money(Math.min(m.sales, m.freeLimit))}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted">{t("commission.taxable")}</dt>
              <dd className="tabular-nums">{money(m.taxable)}</dd>
            </div>
          </>
        )}
        <div className="flex justify-between gap-3 border-t border-line pt-1 font-medium">
          <dt>{t("commission.amount")}</dt>
          <dd className="tabular-nums">{m.accrues ? money(m.commission) : "—"}</dd>
        </div>
      </dl>
    </Card>
  );
}

function CommissionPage() {
  const d = Route.useLoaderData();
  const { shop } = Route.useRouteContext();
  const t = adminT(shop.locale);
  const loc = intlLocale(shop.locale);
  const monthName = (m: string) =>
    new Date(`${m}-01T12:00:00Z`).toLocaleDateString(loc, {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    });
  const rate = d.current.rate;
  return (
    <>
      <PageTitle title={t("commission.title")} />
      <div className="mb-4 space-y-2 text-sm">
        {rate !== null && d.tier ? (
          <p data-testid="commission-rule">
            {t("commission.rule", {
              rate,
              tier: TIER_TITLES[d.tier],
              free: money(d.current.freeLimit),
            })}
          </p>
        ) : (
          <p>{t("commission.noRate")}</p>
        )}
        <p data-testid="commission-bots">{t("commission.bots")}</p>
        {!d.enabled && <p data-testid="commission-off">{t("commission.off")}</p>}
        {d.enabled && rate !== null && (
          <p data-testid="commission-invoice">{t("commission.invoice")}</p>
        )}
        {d.enabled && rate !== null && (
          <p className="text-muted">
            {t("commission.start", {
              date: new Date(`${d.start}T12:00:00Z`).toLocaleDateString(loc, { timeZone: "UTC" }),
            })}
          </p>
        )}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <MonthCard
          title={`${t("commission.thisMonth")}, ${monthName(d.current.month)}`}
          m={d.current}
          t={t}
        />
        <MonthCard
          title={`${t("commission.lastMonth")}, ${monthName(d.previous.month)}`}
          m={d.previous}
          t={t}
        />
      </div>
      {d.advice && (
        <p
          className="mt-4 rounded-md border border-line bg-surface-2 px-3 py-2 text-sm"
          data-testid="commission-advice"
        >
          {t("commission.advice", {
            month: monthName(d.advice.month),
            tier: TIER_TITLES[d.advice.tier],
            cost: money(d.advice.cost),
            current: money(d.advice.currentCost),
            saving: money(d.advice.saving),
          })}
        </p>
      )}
    </>
  );
}
