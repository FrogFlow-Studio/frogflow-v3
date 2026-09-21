import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { listClientsFn } from "@/app/operator/operator.functions";
import { Badge, Empty, PageTitle, Stat } from "@/app/ui";

export const Route = createFileRoute("/operator/_authed/")({
  loader: () => listClientsFn(),
  component: ClientsPage,
});

function ClientsPage() {
  const clients = Route.useLoaderData();
  const [q, setQ] = useState("");
  const shown = clients.filter(
    (c) =>
      !q || c.name.toLowerCase().includes(q.toLowerCase()) || c.slug?.includes(q.toLowerCase()),
  );
  const orders30 = clients.reduce((s, c) => s + (c.stats?.orders_30d ?? 0), 0);
  const customers = clients.reduce((s, c) => s + (c.stats?.customers_total ?? 0), 0);
  return (
    <>
      <PageTitle
        title="Клиенты"
        subtitle={`${clients.length} магазинов на платформе`}
        actions={
          <Link to="/operator/clients/new" className="btn-primary">
            + Подключить клиента
          </Link>
        }
      />
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat
          label="Клиентов"
          value={clients.length}
          hint={`${clients.filter((c) => c.status === "active").length} активных`}
        />
        <Stat label="Заказов за 30 дней" value={orders30} />
        <Stat label="Покупателей" value={customers.toLocaleString("ru")} />
        <Stat
          label="На v2"
          value={clients.filter((c) => c.servedBy === "v2").length}
          hint="обслуживаются этим деплоем"
        />
      </div>
      <input
        className="input mb-3 max-w-sm"
        placeholder="Поиск по названию или адресу"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {shown.length === 0 ? (
        <Empty>Ничего не найдено.</Empty>
      ) : (
        <div className="card overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Клиент</th>
                <th>Ниша</th>
                <th>Статус</th>
                <th>Подписка</th>
                <th>Каналы</th>
                <th className="text-right">Заказов / 30 дн</th>
                <th className="text-right">Товаров</th>
                <th className="text-right">Покупателей</th>
                <th>Модулей</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((c) => (
                <tr key={c.id} className="hover:bg-surface-2/60">
                  <td>
                    <Link
                      to="/operator/clients/$botId"
                      params={{ botId: c.id }}
                      className="font-medium hover:underline"
                    >
                      {c.name}
                    </Link>
                    <div className="text-xs text-muted">
                      {c.slug ? `/s/${c.slug}` : (c.appUrl?.replace(/^https?:\/\//, "") ?? "—")}
                    </div>
                  </td>
                  <td className="text-muted">{c.verticalTitle}</td>
                  <td>
                    <StatusBadge status={c.status} />
                  </td>
                  <td>
                    <SubscriptionBadge s={c.subscription} expiresAt={c.subscriptionExpiresAt} />
                  </td>
                  <td className="space-x-1">
                    {c.telegram.connected ? (
                      <Badge tone={c.servedBy === "v2" ? "ok" : "neutral"}>
                        Telegram {c.servedBy === "v2" ? "· v2" : "· v1"}
                      </Badge>
                    ) : (
                      <Badge>без Telegram</Badge>
                    )}
                    {c.zernioAccounts.length > 0 && <Badge tone="accent">IG/WA</Badge>}
                  </td>
                  <td className="text-right tabular-nums">{c.stats?.orders_30d ?? "—"}</td>
                  <td className="text-right tabular-nums">{c.stats?.products_total ?? "—"}</td>
                  <td className="text-right tabular-nums">
                    {c.stats?.customers_total?.toLocaleString("ru") ?? "—"}
                  </td>
                  <td className="text-muted">{c.modulesOn}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

export function StatusBadge({ status }: { status: string }) {
  if (status === "active") return <Badge tone="ok">активен</Badge>;
  if (status === "paused") return <Badge tone="warn">пауза</Badge>;
  return <Badge tone="danger">приостановлен</Badge>;
}

export function SubscriptionBadge({
  s,
  expiresAt,
}: {
  s: { state: string; daysLeft: number | null };
  expiresAt: string | null;
}) {
  const until = expiresAt ? new Date(expiresAt).toLocaleDateString("ru") : "";
  if (s.state === "no_data") return <Badge>не заведена</Badge>;
  if (s.state === "ok") return <Badge tone="ok">до {until}</Badge>;
  if (s.state === "expiring") return <Badge tone="warn">истекает через {s.daysLeft} дн.</Badge>;
  if (s.state === "overdue") return <Badge tone="warn">просрочена {-(s.daysLeft ?? 0)} дн.</Badge>;
  return <Badge tone="danger">просрочена {-(s.daysLeft ?? 0)} дн.</Badge>;
}
