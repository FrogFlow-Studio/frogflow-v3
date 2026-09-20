import { createFileRoute, Link, Outlet, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { ordersFn } from "@/app/admin/admin.functions";
import { Badge, Empty, PageTitle } from "@/app/ui";
import { formatMoney } from "@/core/money/money";
import { displayNo } from "@/core/orders/pure";

const search = z.object({ status: z.string().optional(), q: z.string().optional() });

export const Route = createFileRoute("/admin/_authed/orders")({
  validateSearch: search,
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => ordersFn({ data: deps }),
  component: OrdersPage,
});

const STATUS_LABEL: Record<
  string,
  { text: string; tone: "neutral" | "ok" | "warn" | "danger" | "accent" }
> = {
  awaiting_payment: { text: "ждёт оплаты", tone: "neutral" },
  awaiting_confirmation: { text: "чек на проверке", tone: "warn" },
  delivering: { text: "выдаётся", tone: "accent" },
  delivered: { text: "выдан", tone: "ok" },
  paid: { text: "оплачен", tone: "accent" },
  accepted: { text: "принят", tone: "accent" },
  in_production: { text: "готовится", tone: "accent" },
  ready: { text: "готов", tone: "warn" },
  rejected: { text: "отклонён", tone: "danger" },
  cancelled: { text: "отменён", tone: "danger" },
};

export function OrderStatus({ status }: { status: string }) {
  const s = STATUS_LABEL[status] ?? { text: status, tone: "neutral" as const };
  return <Badge tone={s.tone}>{s.text}</Badge>;
}

function OrdersPage() {
  const { orders, counts } = Route.useLoaderData();
  const { status, q } = Route.useSearch();
  const navigate = useNavigate();
  const [query, setQuery] = useState(q ?? "");
  const tabs: Array<[string | undefined, string]> = [
    [undefined, "Все"],
    ["awaiting_confirmation", "Чек на проверке"],
    ["awaiting_payment", "Ждут оплаты"],
    ["accepted", "В работе"],
    ["ready", "Готовы"],
    ["delivered", "Выданы"],
    ["rejected", "Отклонены"],
  ];
  return (
    <>
      <PageTitle title="Заказы" />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {tabs.map(([s, label]) => (
          <Link
            key={label}
            to="/admin/orders"
            search={{ status: s, q }}
            className={`badge cursor-pointer ${status === s ? "border-accent bg-accent/10 text-accent" : ""}`}
          >
            {label}
            {s && counts[s] ? ` · ${counts[s]}` : ""}
          </Link>
        ))}
        <form
          className="ml-auto flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void navigate({ to: "/admin/orders", search: { status, q: query || undefined } });
          }}
        >
          <input
            className="input w-56"
            placeholder="№, имя, телефон"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button className="btn-secondary">Найти</button>
        </form>
      </div>
      {orders.length === 0 ? (
        <Empty>Заказов нет.</Empty>
      ) : (
        <div className="card overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>№</th>
                <th>Покупатель</th>
                <th>Состав</th>
                <th className="text-right">Сумма</th>
                <th>Статус</th>
                <th>Канал</th>
                <th>Когда</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id} className="hover:bg-surface-2/60">
                  <td>
                    <Link
                      to="/admin/orders/$id"
                      params={{ id: String(o.id) }}
                      className="font-medium hover:underline"
                    >
                      #{displayNo(o)}
                    </Link>
                  </td>
                  <td>
                    {o.display_name}
                    <div className="text-xs text-muted">{o.contact ?? o.customer_email ?? ""}</div>
                  </td>
                  <td className="max-w-xs truncate text-muted">
                    {(o.order_items ?? []).map((i) => i.name_snapshot).join(", ")}
                  </td>
                  <td className="text-right tabular-nums">{formatMoney(o.total, o.currency)}</td>
                  <td>
                    <OrderStatus status={o.status} />
                  </td>
                  <td className="text-muted">{o.platform}</td>
                  <td className="whitespace-nowrap text-muted">
                    {new Date(o.created_at).toLocaleString("ru", {
                      dateStyle: "short",
                      timeStyle: "short",
                    })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Outlet />
    </>
  );
}
