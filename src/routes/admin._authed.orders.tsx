import { canEdit } from "@/core/auth/roles";
import {
  createFileRoute,
  Link,
  Outlet,
  useNavigate,
  useRouteContext,
  useRouter,
} from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { ordersFn } from "@/app/admin/admin.functions";
import { assembleOrdersFn, orderBatchCountFn } from "@/app/admin/batch.functions";
import { useLiveOrders } from "@/app/admin/live-orders";
import { adminT, intlLocale, type AdminKey } from "@/app/i18n/admin";
import { Badge, Empty, ErrorBox, PageTitle, useAction } from "@/app/ui";
import { usePullToRefresh } from "@/app/ui/pull-to-refresh";
import { EmptyState } from "@/app/ui/states";
import { BATCH_MAX } from "@/core/orders/batch-pure";
import { formatMoney } from "@/core/money/money";
import { displayNo } from "@/core/orders/pure";
import { slotOf } from "@/core/fulfillment/slots";

const search = z.object({
  status: z.string().optional(),
  q: z.string().optional(),
  pickup: z.enum(["today", "tomorrow", "overdue", "nodate"]).optional(),
  /** «Не доплачено»: задаток внесён, остаток нет (core/orders/admin underpaidOrderIds). */
  unpaid: z.boolean().optional(),
  /** «К сборке сегодня»: принятые и в работе с днём получения «сегодня» (А16). */
  assembly: z.literal("today").optional(),
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
  refunded: "danger",
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
  "refunded",
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

/** Поля фильтра в строку запроса: пустые не берём, `true` — «true». */
function flat(o: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(o)
      .filter(([, v]) => v !== undefined && v !== "")
      .map(([k, v]) => [k, String(v)]),
  );
}

function OrdersPage() {
  useLiveOrders();
  const { orders, counts, load } = Route.useLoaderData();
  const { shop } = Route.useRouteContext();
  const t = adminT(shop.locale);
  const { status, q, pickup, unpaid, assembly } = Route.useSearch();
  const physical = shop.vertical === "confectionery" || shop.vertical === "flowers";
  const navigate = useNavigate();
  const router = useRouter();
  const pull = usePullToRefresh(() => router.invalidate());
  const [query, setQuery] = useState(q ?? "");
  const filter = { status, q, pickup, unpaid, assembly };
  const filterKey = JSON.stringify(filter);
  // Выбор для «пачки» (А16): отдельные заказы страницы или «все N по фильтру».
  const [picked, setPicked] = useState<number[]>([]);
  const [matching, setMatching] = useState<number | null>(null);
  const [allMode, setAllMode] = useState(false);
  const [batchMsg, setBatchMsg] = useState<string | null>(null);
  // Другой фильтр — другой список: выбор не переносим.
  useEffect(() => {
    setPicked([]);
    setAllMode(false);
    setMatching(null);
  }, [filterKey]);
  const pageIds = orders.map((o) => o.id);
  const pageAllPicked = pageIds.length > 0 && pageIds.every((id) => picked.includes(id));
  // Выбрана вся страница — узнаём, сколько заказов по фильтру всего (постранично, на сервере).
  useEffect(() => {
    if (!pageAllPicked || matching !== null) return;
    let live = true;
    void orderBatchCountFn({ data: filter })
      .then((r) => live && setMatching(r.count))
      .catch(() => {});
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageAllPicked, matching, filterKey]);
  const toggle = (id: number) => {
    setAllMode(false);
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  };
  const togglePage = () => {
    setAllMode(false);
    setPicked(pageAllPicked ? [] : pageIds);
  };
  const total = allMode ? (matching ?? picked.length) : picked.length;
  const printSearch = allMode ? filter : { ids: picked.join(",") };
  const tooMany = total > BATCH_MAX;
  const assemble = useAction(async () => {
    if (!confirm(t("orders.batch.assembleHint"))) return;
    const r = await assembleOrdersFn({ data: allMode ? { filter } : { ids: picked } });
    setBatchMsg(
      [
        t("orders.batch.done", { assembled: r.assembled, already: r.already, skipped: r.skipped }),
        r.notNotified ? t("orders.batch.notNotified", { n: r.notNotified }) : "",
        r.remaining ? t("orders.batch.remaining", { n: r.remaining }) : "",
      ]
        .filter(Boolean)
        .join(" "),
    );
    setPicked([]);
    setAllMode(false);
    await router.invalidate();
  });
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
        "refunded",
      ] as const
    ).map((k): [string, string] => [k, t(`orders.tab.${k}` as AdminKey)]),
  ];
  return (
    <>
      {pull !== "idle" && (
        <p role="status" className="mb-2 text-center text-xs text-muted md:hidden">
          {pull === "busy"
            ? t("orders.refreshing")
            : pull === "ready"
              ? t("orders.pullRelease")
              : t("orders.pull")}
        </p>
      )}
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
              search={{ status, q, pickup: pickup === k ? undefined : k, unpaid, assembly }}
              className={`badge cursor-pointer ${pickup === k ? "border-accent bg-accent/10 text-accent" : ""}`}
            >
              {t(`physical.pickup.${k}`)}
            </Link>
          ))}
        </div>
      )}
      {physical && load && (
        <div className="mb-3 space-y-1 text-sm">
          {load.days.map((d, i) => (
            <div key={d.date} className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="text-muted">
                {t("physical.load.label")}{" "}
                {t(i === 0 ? "physical.pickup.today" : "physical.pickup.tomorrow")}
              </span>
              <span
                className={`badge ${load.limits.day !== null && d.total >= load.limits.day ? "border-danger text-danger" : ""}`}
              >
                {d.total}
                {load.limits.day !== null ? ` / ${load.limits.day}` : ""}
              </span>
              {d.slots.map((x) => (
                <span
                  key={x.slot}
                  className={`badge ${load.limits.slot !== null && x.count >= load.limits.slot ? "border-danger text-danger" : ""}`}
                >
                  {x.slot}: {x.count}
                  {load.limits.slot !== null ? ` / ${load.limits.slot}` : ""}
                </span>
              ))}
            </div>
          ))}
        </div>
      )}
      {(physical || unpaid || (counts.unpaid ?? 0) > 0) && (
        <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
          {physical && (
            <Link
              to="/admin/orders"
              search={{ status, q, pickup, unpaid, assembly: assembly ? undefined : "today" }}
              className={`badge cursor-pointer ${assembly ? "border-accent bg-accent/10 text-accent" : ""}`}
            >
              {t("orders.filter.assembly")}
            </Link>
          )}
          <Link
            to="/admin/orders"
            search={{ status, q, pickup, unpaid: unpaid ? undefined : true, assembly }}
            className={`badge cursor-pointer ${unpaid ? "border-accent bg-accent/10 text-accent" : ""}`}
          >
            {t("physical.unpaid")}
            {counts.unpaid ? ` · ${counts.unpaid}` : ""}
          </Link>
        </div>
      )}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div
          role="group"
          aria-label={t("orders.filtersLabel")}
          className="-mx-4 flex w-[calc(100%+2rem)] gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:w-auto md:flex-wrap md:overflow-visible md:px-0 md:pb-0 [&>a]:shrink-0 [&>a]:whitespace-nowrap"
        >
          {tabs.map(([s, label]) => (
            <Link
              key={label}
              to="/admin/orders"
              search={{ status: s, q, pickup, unpaid, assembly }}
              className={`badge cursor-pointer ${status === s ? "border-accent bg-accent/10 text-accent" : ""}`}
            >
              {label}
              {s && counts[s] ? ` · ${counts[s]}` : ""}
            </Link>
          ))}
        </div>
        <form
          className="flex w-full gap-2 md:ml-auto md:w-auto"
          onSubmit={(e) => {
            e.preventDefault();
            void navigate({
              to: "/admin/orders",
              search: { status, q: query || undefined, pickup, unpaid, assembly },
            });
          }}
        >
          <input
            className="input min-w-0 flex-1 md:w-56 md:flex-none"
            placeholder={t("orders.searchPlaceholder")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button className="btn-secondary">{t("common.search")}</button>
        </form>
      </div>
      {(picked.length > 0 || allMode) && (
        <div
          role="region"
          aria-label={t("orders.batch.selected", { n: total })}
          className="card sticky top-2 z-10 mb-3 flex flex-wrap items-center gap-2 p-3 text-sm"
        >
          <span className="font-medium">{t("orders.batch.selected", { n: total })}</span>
          {!allMode && pageAllPicked && matching !== null && matching > pageIds.length && (
            <button
              type="button"
              className="btn-secondary text-xs"
              onClick={() => setAllMode(true)}
            >
              {t("orders.batch.selectFilter", { n: matching })}
            </button>
          )}
          {!allMode && pageAllPicked && matching === null && (
            <span className="text-xs text-muted">{t("orders.batch.counting")}</span>
          )}
          {allMode && (
            <span className="text-xs text-muted">
              {t("orders.batch.filterPicked", { n: total })}
            </span>
          )}
          {tooMany ? (
            <span className="text-xs text-danger">
              {t("orders.batch.printLimit", { max: BATCH_MAX })}
            </span>
          ) : (
            <>
              <a
                className="btn-secondary text-xs"
                href={`/admin/print-batch?${new URLSearchParams({ kind: "slips", ...flat(printSearch) })}`}
                target="_blank"
                rel="noreferrer"
              >
                {t("orders.batch.slips")}
              </a>
              <a
                className="btn-secondary text-xs"
                href={`/admin/print-batch?${new URLSearchParams({ kind: "labels", ...flat(printSearch) })}`}
                target="_blank"
                rel="noreferrer"
              >
                {t("orders.batch.labels")}
              </a>
            </>
          )}
          {canEdit(shop.role) && (
            <button
              type="button"
              className="btn-primary text-xs"
              disabled={assemble.busy}
              onClick={() => void assemble.run().catch(() => {})}
            >
              {t("orders.batch.assemble")}
            </button>
          )}
          <button
            type="button"
            className="btn-ghost text-xs"
            onClick={() => {
              setPicked([]);
              setAllMode(false);
            }}
          >
            {t("orders.batch.clear")}
          </button>
          <ErrorBox error={assemble.error} />
        </div>
      )}
      {batchMsg && (
        <p role="status" className="mb-3 text-sm">
          {batchMsg}
        </p>
      )}
      {orders.length === 0 ? (
        status || q || pickup || unpaid || assembly ? (
          <Empty>{t("orders.empty")}</Empty>
        ) : (
          <EmptyState
            title={t("orders.emptyTitle")}
            hint={t("orders.emptyHint")}
            action={{ label: t("nav.botPreview"), to: "/admin/bot-preview" }}
          />
        )
      ) : (
        <>
          <ul className="space-y-2 md:hidden">
            {orders.map((o) => (
              <li key={o.id} className="flex items-start gap-2">
                <input
                  type="checkbox"
                  className="mt-4"
                  aria-label={t("orders.batch.pick", { no: displayNo(o) })}
                  checked={picked.includes(o.id)}
                  onChange={() => toggle(o.id)}
                />
                <Link
                  to="/admin/orders/$id"
                  params={{ id: String(o.id) }}
                  className="card block min-w-0 flex-1 p-3 text-sm"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">#{displayNo(o)}</span>
                    <OrderStatus status={o.status} />
                  </div>
                  <div className="mt-1 truncate">{o.display_name}</div>
                  <div className="truncate text-xs text-muted">
                    {o.contact ?? o.customer_email ?? ""}
                  </div>
                  <div className="truncate text-xs text-muted">
                    {(o.order_items ?? []).map((i) => i.name_snapshot).join(", ")}
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <span className="tabular-nums font-medium">
                      {formatMoney(o.total, o.currency)}
                    </span>
                    <span className="text-xs text-muted">
                      {new Date(o.created_at).toLocaleString(intlLocale(shop.locale), {
                        dateStyle: "short",
                        timeStyle: "short",
                      })}
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
          <div className="card hidden overflow-x-auto md:block">
            <table className="table">
              <thead>
                <tr>
                  <th>
                    <input
                      type="checkbox"
                      aria-label={t("orders.batch.pickAll")}
                      checked={pageAllPicked}
                      onChange={togglePage}
                    />
                  </th>
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
                      <input
                        type="checkbox"
                        aria-label={t("orders.batch.pick", { no: displayNo(o) })}
                        checked={picked.includes(o.id)}
                        onChange={() => toggle(o.id)}
                      />
                    </td>
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
                      <div className="text-xs text-muted">
                        {o.contact ?? o.customer_email ?? ""}
                      </div>
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
                          {slotOf(o.fulfillment_at, []) && ` ${slotOf(o.fulfillment_at, [])}`}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <Outlet />
    </>
  );
}
