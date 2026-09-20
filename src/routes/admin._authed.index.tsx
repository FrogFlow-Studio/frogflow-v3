import { createFileRoute, Link } from "@tanstack/react-router";
import { dashboardFn } from "@/app/admin/admin.functions";
import { Card, Empty, PageTitle, Stat } from "@/app/ui";
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
  const attention = (d.counts.awaiting_confirmation ?? 0) + (d.counts.ready ?? 0);
  return (
    <>
      <PageTitle
        title="Обзор"
        subtitle={`${shop.verticalTitle}${shop.telegram ? ` · @${shop.telegram}` : ""}`}
      />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Требуют действия" value={attention} hint="чеки на проверке и готовые заказы" />
        <Stat
          label="Выручка за 30 дней"
          value={formatMoney(d.rev30.total, d.rev30.currency)}
          hint={`${d.rev30.orders} оплаченных заказов`}
        />
        <Stat label="Товаров в продаже" value={d.products} />
        <Stat label="Покупателей" value={d.customers.toLocaleString("ru")} />
      </div>
      <div className="mt-6 grid gap-4 lg:grid-cols-[2fr_1fr]">
        <Card
          title="Последние заказы"
          actions={
            <Link to="/admin/orders" className="text-xs text-accent hover:underline">
              все заказы
            </Link>
          }
        >
          {d.recent.length === 0 ? (
            <Empty>Заказов пока нет.</Empty>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>№</th>
                  <th>Покупатель</th>
                  <th>Сумма</th>
                  <th>Статус</th>
                  <th>Когда</th>
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
                    <td className="text-muted">
                      {new Date(o.created_at).toLocaleDateString("ru")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
        <Card title="Заказы по статусам">
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
