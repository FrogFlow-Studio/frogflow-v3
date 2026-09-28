import { canEdit } from "@/core/auth/roles";
import {
  createFileRoute,
  Link,
  Outlet,
  useNavigate,
  useRouteContext,
} from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { ordersFn } from "@/app/admin/admin.functions";
import { useLiveOrders } from "@/app/admin/live-orders";
import { adminT, intlLocale, type AdminKey } from "@/app/i18n/admin";
import { Badge, Empty, PageTitle } from "@/app/ui";
import { formatMoney } from "@/core/money/money";
import { displayNo } from "@/core/orders/pure";

const search = z.object({
  status: z.string().optional(),
  q: z.string().optional(),
  pickup: z.enum(["today", "tomorrow", "overdue", "nodate"]).optional(),
  /** «Не доплачено»: задаток внесён, остаток нет (core/orders/admin underpaidOrderIds). */
  unpaid: z.boolean().optional(),
});

const PICKUP_KEYS = ["today", "tomorrow", "overdue", "nodate"] as const;

export const Route = createFileRoute("/admin/_authed/orders")({
  validateSearch: search,
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => ordersFn({ data: deps }),
  component: OrdersPage,
});

const STATUS_TONE: Record<string, "neutral" | "ok" | "warn" | "danger" | "accent"> = {
  awaiting_payment: "neutral",
  awaiting_confirmation: "warn",
  delivering: "accent",
  delivered: "ok",
  paid: "accent",
  accepted: "accent",
  in_production: "accent",
  ready: "warn",
  rejected: "danger",
  cancelled: "danger",
};

const STATUS_KEYS = [
  "awaiting_payment",
  "awaiting_confirmation",
  "delivering",
  "delivered",
  "paid",
  "accepted",
  "in_production",
  "ready",
  "rejected",
  "cancelled",
] as const;

export function OrderStatus({ status }: { status: string }) {
  const { shop } = useRouteContext({ from: "/admin/_authed" });
  const t = adminT(shop.locale);
  const known = (STATUS_KEYS as readonly string[]).includes(status);
  return (
    <Badge tone={STATUS_TONE[status] ?? "neutral"}>
      {known ? t(`orders.status.${status as (typeof STATUS_KEYS)[number]}`) : status}
    </Badge>
  );
}

/** `paymentsOnly` — роль «просмотр»: заказы с контактами ей не выгружаются, «Оплаты» без них — да. */
function ExportButton({ paymentsOnly = false }: { paymentsOnly?: boolean }) {
  const { shop } = useRouteContext({ from: "/admin/_authed" });
  const t = adminT(shop.locale);
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const href = `/api/admin/export/orders?from=${from}&to=${to}`;
  return (
    <div className="relative">
      <button type="button" className="btn-secondary text-xs" onClick={() => setOpen(!open)}>
        {t("common.exportExcel")}
      </button>
      {open && (
        <div className="absolute right-0 z-10 mt-1 w-64 space-y-2 rounded-md border border-line bg-surface p-3 shadow-md">
          <label className="block text-xs text-muted">
            {t("orders.export.from")}
            <input
              className="input mt-1"
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label className="block text-xs text-muted">
            {t("orders.export.to")}
            <input
              className="input mt-1"
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
          {!paymentsOnly && (
            <>
              <a
                className="btn-primary block text-center text-xs"
                href={href}
                onClick={() => setOpen(false)}
              >
                {t("common.downloadCsv")}
              </a>
              <p className="text-xs text-muted">{t("orders.export.hint")}</p>
            </>
          )}
          <a
            className="btn-secondary block text-center text-xs"
            href={`/api/admin/export/payments?from=${from}&to=${to}`}
            onClick={() => setOpen(false)}
          >
            {t("orders.export.payments")}
          </a>
          <p className="text-xs text-muted">{t("orders.export.paymentsHint")}</p>
          {!paymentsOnly && (
            <div className="space-y-1 border-t border-line pt-2">
              <a
                className="btn-secondary block text-center text-xs"
                href="/api/admin/export/all"
                onClick={() => setOpen(false)}
              >
                {t("orders.export.all")}
              </a>
              <p className="text-xs text-muted">{t("orders.export.allHint")}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function OrdersPage() {
  useLiveOrders();
  const { orders, counts } = Route.useLoaderData();
  const { shop } = Route.useRouteContext();
  const t = adminT(shop.locale);
  const { status, q, pickup, unpaid } = Route.useSearch();
  const physical = shop.vertical === "confectionery" || shop.vertical === "flowers";
  const navigate = useNavigate();
  const [query, setQuery] = useState(q ?? "");
  const tabs: Array<[string | undefined, string]> = [
    [undefined, t("common.all")],
    ...(
      [
        "awaiting_confirmation",
        "awaiting_payment",
        "accepted",
        "ready",
        "delivered",
        "rejected",
      ] as const
    ).map((k): [string, string] => [k, t(`orders.tab.${k}` as AdminKey)]),
  ];
  return (
    <>
      <PageTitle
        title={t("orders.title")}
        actions={
          <div className="flex gap-2">
            {physical && canEdit(shop.role) && (
              <Link
                to="/admin/orders/new"
                search={{ status, q, pickup, unpaid }}
                className="btn-primary text-xs"
              >
                {t("physical.newOrder")}
              </Link>
            )}
            {/* В заказах имена и телефоны: роль «просмотр» выгружает только «Оплаты» (сервер тоже). */}
            {shop.modules.excel_export && (
              <ExportButton paymentsOnly={!canEdit(shop.role) && shop.role !== "accountant"} />
            )}
          </div>
        }
      />
      {physical && (
        <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted">{t("physical.pickupLabel")}</span>
          {PICKUP_KEYS.map((k) => (
            <Link
              key={k}
              to="/admin/orders"
              search={{ status, q, pickup: pickup === k ? undefined : k, unpaid }}
              className={`badge cursor-pointer ${pickup === k ? "border-accent bg-accent/10 text-accent" : ""}`}
            >
              {t(`physical.pickup.${k}`)}
            </Link>
          ))}
        </div>
      )}
      {(physical || unpaid || (counts.unpaid ?? 0) > 0) && (
        <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
          <Link
            to="/admin/orders"
            search={{ status, q, pickup, unpaid: unpaid ? undefined : true }}
            className={`badge cursor-pointer ${unpaid ? "border-accent bg-accent/10 text-accent" : ""}`}
          >
            {t("physical.unpaid")}
            {counts.unpaid ? ` · ${counts.unpaid}` : ""}
          </Link>
        </div>
      )}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {tabs.map(([s, label]) => (
          <Link
            key={label}
            to="/admin/orders"
            search={{ status: s, q, pickup, unpaid }}
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
            void navigate({
              to: "/admin/orders",
              search: { status, q: query || undefined, pickup, unpaid },
            });
          }}
        >
          <input
            className="input w-56"
            placeholder={t("orders.searchPlaceholder")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button className="btn-secondary">{t("common.search")}</button>
        </form>
      </div>
      {orders.length === 0 ? (
        <Empty>{t("orders.empty")}</Empty>
      ) : (
        <div className="card overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>{t("orders.col.no")}</th>
                <th>{t("orders.col.customer")}</th>
                <th>{t("orders.col.items")}</th>
                <th className="text-right">{t("orders.col.total")}</th>
                <th>{t("orders.col.status")}</th>
                <th>{t("orders.col.channel")}</th>
                <th>{t("orders.col.when")}</th>
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
                  <td className="text-right tabular-nums">
                    {formatMoney(o.total, o.currency)}
                    {o.fulfillment_kind === "physical" &&
                      Number(o.paid_amount) > 0 &&
                      Number(o.paid_amount) < Number(o.total) && (
                        <div className="text-xs text-muted">
                          {t("physical.paid")} {formatMoney(o.paid_amount, o.currency)}
                        </div>
                      )}
                  </td>
                  <td>
                    <OrderStatus status={o.status} />
                  </td>
                  <td className="text-muted">
                    {o.platform === "web" ? t("order.platformWeb") : o.platform}
                  </td>
                  <td className="whitespace-nowrap text-muted">
                    {new Date(o.created_at).toLocaleString(intlLocale(shop.locale), {
                      dateStyle: "short",
                      timeStyle: "short",
                    })}
                    {o.fulfillment_at && (
                      <div className="text-xs text-fg">
                        →{" "}
                        {new Date(o.fulfillment_at).toLocaleDateString(intlLocale(shop.locale), {
                          timeZone: "UTC",
                          day: "2-digit",
                          month: "2-digit",
                        })}
                      </div>
                    )}
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
