import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { dashboardFn, hideSetupFn } from "@/app/admin/admin.functions";
import { adminT, intlLocale } from "@/app/i18n/admin";
import { verticalTitleKey } from "@/app/i18n/admin/catalog";
import { Card, Empty, PageTitle, Stat, useAction } from "@/app/ui";
import { formatMoney } from "@/core/money/money";
import { displayNo } from "@/core/orders/pure";
import { OrderStatus } from "./admin._authed.orders";

export const Route = createFileRoute("/admin/_authed/")({
  loader: () => dashboardFn(),
  component: Dashboard,
});

function Dashboard() {
  const d = Route.useLoaderData();
  const { shop } = Route.useRouteContext();
  const t = adminT(shop.locale);
  const loc = intlLocale(shop.locale);
  const router = useRouter();
  const attention = (d.counts.awaiting_confirmation ?? 0) + (d.counts.ready ?? 0);
  const steps = [
    d.setup.telegram,
    d.setup.products,
    d.setup.payment,
    d.setup.notifications,
    d.setup.legal,
    d.setup.firstOrder,
  ];
  const doneCount = steps.filter(Boolean).length;
  const hide = useAction(async () => {
    await hideSetupFn();
    await router.invalidate();
  });
  return (
    <>
      <PageTitle
        title={t("overview.title")}
        subtitle={`${t(verticalTitleKey(shop.vertical))}${shop.telegram ? ` · @${shop.telegram}` : ""}`}
      />
      {!d.setup.hidden && doneCount < steps.length && (
        <Card
          title={`${t("overview.steps")} · ${t("overview.stepsOf", { done: doneCount, total: steps.length })}`}
          className="mb-6"
          actions={
            <button
              className="btn-ghost text-xs"
              disabled={hide.busy}
              onClick={() => void hide.run().catch(() => {})}
            >
              {t("common.hide")}
            </button>
          }
        >
          <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-line">
            <div
              className="h-full bg-accent transition-all"
              style={{ width: `${Math.round((doneCount / steps.length) * 100)}%` }}
            />
          </div>
          <p className="mb-3 text-sm text-muted">{t("overview.stepsIntro")}</p>
          <ol className="space-y-2 text-sm">
            <Step done={d.setup.telegram} to="/admin/settings" title={t("overview.step.telegram")}>
              {t("overview.step.telegramHint")}
            </Step>
            <Step done={d.setup.products} to="/admin/products" title={t("overview.step.products")}>
              {t("overview.step.productsHint")}
            </Step>
            <Step done={d.setup.payment} to="/admin/settings" title={t("overview.step.payment")}>
              {t("overview.step.paymentHint")}
            </Step>
            <Step
              done={d.setup.notifications}
              to="/admin/settings"
              title={t("overview.step.notifications")}
            >
              {t("overview.step.notificationsHint")}
            </Step>
            <Step done={d.setup.legal} to="/admin/settings" title={t("overview.step.legal")}>
              {t("overview.step.legalHint")}
            </Step>
            <Step
              done={d.setup.firstOrder}
              to="/admin/orders"
              title={t("overview.step.firstOrder")}
            >
              {t("overview.step.firstOrderHint")}
            </Step>
          </ol>
          {d.setup.slug && (
            <p className="mt-3 text-xs text-muted">
              {t("overview.storefront")} <span className="font-mono">/s/{d.setup.slug}</span>
              {shop.telegram && (
                <>
                  {" "}
                  · {t("overview.bot")} <span className="font-mono">t.me/{shop.telegram}</span>
                </>
              )}
            </p>
          )}
        </Card>
      )}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat
          label={t("overview.attention")}
          value={attention}
          hint={t("overview.attentionHint")}
        />
        <Stat
          label={t("overview.revenue30")}
          value={formatMoney(d.rev30.total, d.rev30.currency)}
          hint={t("overview.paidOrders", { n: d.rev30.orders })}
        />
        <Stat label={t("overview.productsOnSale")} value={d.products} />
        <Stat label={t("overview.customers")} value={d.customers.toLocaleString(loc)} />
      </div>
      <div className="mt-6 grid gap-4 lg:grid-cols-[2fr_1fr]">
        <Card
          title={t("overview.recentOrders")}
          actions={
            <Link to="/admin/orders" className="text-xs text-accent hover:underline">
              {t("overview.allOrders")}
            </Link>
          }
        >
          {d.recent.length === 0 ? (
            <Empty>{t("overview.noOrders")}</Empty>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>{t("orders.col.no")}</th>
                  <th>{t("orders.col.customer")}</th>
                  <th>{t("orders.col.total")}</th>
                  <th>{t("orders.col.status")}</th>
                  <th>{t("orders.col.when")}</th>
                </tr>
              </thead>
              <tbody>
                {d.recent.map((o) => (
                  <tr key={o.id}>
                    <td>
                      <Link
                        to="/admin/orders/$id"
                        params={{ id: String(o.id) }}
                        className="font-medium hover:underline"
                      >
                        #{displayNo(o)}
                      </Link>
                    </td>
                    <td>{o.display_name}</td>
                    <td className="tabular-nums">{formatMoney(o.total, o.currency)}</td>
                    <td>
                      <OrderStatus status={o.status} />
                    </td>
                    <td className="text-muted">{new Date(o.created_at).toLocaleDateString(loc)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
        <Card title={t("overview.byStatus")}>
          <ul className="space-y-2 text-sm">
            {(
              [
                "awaiting_payment",
                "awaiting_confirmation",
                "delivering",
                "delivered",
                "accepted",
                "in_production",
                "ready",
                "rejected",
              ] as const
            )
              .filter((s) => d.counts[s])
              .map((s) => (
                <li key={s} className="flex items-center justify-between">
                  <Link to="/admin/orders" search={{ status: s }} className="hover:underline">
                    <OrderStatus status={s} />
                  </Link>
                  <span className="tabular-nums">{d.counts[s]}</span>
                </li>
              ))}
          </ul>
        </Card>
      </div>
    </>
  );
}

function Step({
  done,
  to,
  title,
  children,
}: {
  done: boolean;
  to: "/admin/settings" | "/admin/products" | "/admin/orders";
  title: string;
  children: ReactNode;
}) {
  return (
    <li className="flex gap-3">
      <span
        className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-xs ${done ? "bg-ok text-white" : "border border-line text-muted"}`}
      >
        {done ? "✓" : ""}
      </span>
      <div>
        {done ? (
          <span className="font-medium text-muted line-through">{title}</span>
        ) : (
          <Link to={to} className="font-medium text-accent hover:underline">
            {title}
          </Link>
        )}
        {!done && <p className="text-muted">{children}</p>}
      </div>
    </li>
  );
}
