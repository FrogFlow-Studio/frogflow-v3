import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { journalFn, journalProductsFn } from "@/app/admin/warehouse.functions";
import { adminT, intlLocale } from "@/app/i18n/admin";
import { Card, ErrorBox, Field, PageTitle, useAction } from "@/app/ui";
import { STOCK_REASONS } from "@/core/catalog/stock-history";

export const Route = createFileRoute("/admin/_authed/warehouse/journal")({
  beforeLoad: ({ context }) => {
    if (!context.shop.modules.warehouse) throw redirect({ to: "/admin" });
  },
  loader: () => journalFn({ data: { page: 0, filter: {} } }),
  component: JournalPage,
});

type Data = Awaited<ReturnType<typeof journalFn>>;
type Filter = {
  productId: string;
  productName: string;
  reason: string;
  supplierId: string;
  from: string;
  to: string;
};
const EMPTY: Filter = {
  productId: "",
  productName: "",
  reason: "",
  supplierId: "",
  from: "",
  to: "",
};

const toData = (f: Filter) => ({
  productId: f.productId || null,
  reason: f.reason || null,
  supplierId: f.supplierId || null,
  from: f.from || null,
  to: f.to || null,
});

function JournalPage() {
  const first = Route.useLoaderData();
  const { shop } = Route.useRouteContext();
  const t = adminT(shop.locale);
  const [filter, setFilter] = useState<Filter>(EMPTY);
  const [applied, setApplied] = useState<Filter>(EMPTY);
  const [entries, setEntries] = useState<Data["entries"]>(first.entries);
  const [total, setTotal] = useState(first.total);
  const [page, setPage] = useState(0);
  const [found, setFound] = useState<Awaited<ReturnType<typeof journalProductsFn>> | null>(null);
  const [query, setQuery] = useState("");
  const load = useAction(async (f: Filter) => {
    const r = await journalFn({ data: { page: 0, filter: toData(f) } });
    setEntries(r.entries);
    setTotal(r.total);
    setPage(0);
    setApplied(f);
  });
  const more = useAction(async () => {
    const r = await journalFn({ data: { page: page + 1, filter: toData(applied) } });
    setEntries((cur) => [...cur, ...r.entries.filter((e) => !cur.some((c) => c.id === e.id))]);
    setPage(page + 1);
  });
  const search = useAction(async (q: string) => {
    setQuery(q);
    setFound(await journalProductsFn({ data: { q } }));
  });
  const when = (iso: string) =>
    new Date(iso).toLocaleString(intlLocale(shop.locale), {
      dateStyle: "short",
      timeStyle: "short",
    });
  const csvQuery = new URLSearchParams(
    Object.entries(toData(applied)).flatMap(([k, v]) => (v ? [[k, String(v)]] : [])),
  ).toString();
  const reasonLabel = (r: string) => t(`journal.reason.${r as "order"}`);
  const change = (e: Data["entries"][number]) => {
    const from = e.from === null ? t("journal.untracked") : String(e.from);
    const to = e.to === null ? t("journal.untracked") : String(e.to);
    const delta = e.from !== null && e.to !== null ? e.to - e.from : null;
    return `${from} → ${to}${delta === null ? "" : ` (${delta > 0 ? "+" : ""}${delta})`}`;
  };
  return (
    <>
      <PageTitle
        title={t("journal.title")}
        subtitle={t("journal.subtitle")}
        actions={
          shop.role === "accountant" ? undefined : (
            <Link to="/admin/warehouse" className="btn-ghost">
              {t("warehouse.back")}
            </Link>
          )
        }
      />
      <div className="space-y-3">
        <Card>
          <form
            className="grid gap-3 sm:grid-cols-3"
            onSubmit={(e) => {
              e.preventDefault();
              void load.run(filter).catch(() => {});
            }}
          >
            <div className="sm:col-span-3">
              <div className="label">{t("journal.product")}</div>
              {filter.productId ? (
                <div className="flex items-center gap-2 rounded-md border border-line px-3 py-2 text-sm">
                  <span className="min-w-0 flex-1 truncate">{filter.productName}</span>
                  <button
                    type="button"
                    className="btn-ghost text-xs"
                    onClick={() => setFilter({ ...filter, productId: "", productName: "" })}
                  >
                    {t("journal.clear")}
                  </button>
                </div>
              ) : (
                <div className="space-y-1">
                  <input
                    className="input"
                    type="search"
                    placeholder={t("journal.productAny")}
                    value={query}
                    onChange={(e) => void search.run(e.target.value).catch(() => {})}
                    onFocus={() => {
                      if (!found) void search.run("").catch(() => {});
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.preventDefault();
                    }}
                  />
                  {found && query && (
                    <div className="max-h-48 overflow-auto rounded-md border border-line">
                      {found.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          className="block w-full truncate px-2 py-1.5 text-left text-sm hover:bg-surface-2"
                          onClick={() => {
                            setFilter({ ...filter, productId: p.id, productName: p.name });
                            setQuery("");
                          }}
                        >
                          {p.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
            <Field label={t("journal.reason")}>
              <select
                className="input"
                value={filter.reason}
                onChange={(e) => setFilter({ ...filter, reason: e.target.value })}
              >
                <option value="">{t("journal.reasonAny")}</option>
                {STOCK_REASONS.map((r) => (
                  <option key={r} value={r}>
                    {reasonLabel(r)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t("journal.supplier")}>
              <select
                className="input"
                value={filter.supplierId}
                onChange={(e) => setFilter({ ...filter, supplierId: e.target.value })}
              >
                <option value="">{t("journal.supplierAny")}</option>
                {first.suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label={t("journal.from")}>
                <input
                  className="input"
                  type="date"
                  value={filter.from}
                  onChange={(e) => setFilter({ ...filter, from: e.target.value })}
                />
              </Field>
              <Field label={t("journal.to")}>
                <input
                  className="input"
                  type="date"
                  value={filter.to}
                  onChange={(e) => setFilter({ ...filter, to: e.target.value })}
                />
              </Field>
            </div>
            <div className="flex flex-wrap gap-2 sm:col-span-3">
              <button className="btn-primary" disabled={load.busy}>
                {t("journal.apply")}
              </button>
              <button
                type="button"
                className="btn-ghost"
                onClick={() => {
                  setFilter(EMPTY);
                  void load.run(EMPTY).catch(() => {});
                }}
              >
                {t("journal.reset")}
              </button>
              <a className="btn-ghost" href={`/api/admin/export/stock-journal?${csvQuery}`}>
                {t("journal.csv")}
              </a>
            </div>
          </form>
          <ErrorBox error={load.error ?? search.error} />
        </Card>
        <Card
          actions={<span className="text-xs text-muted">{t("journal.found", { n: total })}</span>}
        >
          {entries.length === 0 ? (
            <p className="text-sm text-muted">{t("journal.empty")}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>{t("journal.col.date")}</th>
                    <th>{t("journal.col.product")}</th>
                    <th>{t("journal.col.reason")}</th>
                    <th>{t("journal.col.change")}</th>
                    <th>{t("journal.col.who")}</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((e) => (
                    <tr key={e.id}>
                      <td className="whitespace-nowrap">{when(e.at)}</td>
                      <td>{e.name}</td>
                      <td>
                        {reasonLabel(e.reason)}
                        {e.orderNo !== null && (
                          <span className="block text-xs text-muted">
                            {t("journal.order", { no: e.orderNo })}
                          </span>
                        )}
                        {e.receiptNo !== null && (
                          <span className="block text-xs text-muted">
                            {t("journal.receipt", { no: e.receiptNo })}
                            {e.supplierName ? ` · ${e.supplierName}` : ""}
                          </span>
                        )}
                        {e.note && <span className="block text-xs text-muted">{e.note}</span>}
                      </td>
                      <td className="whitespace-nowrap tabular-nums">{change(e)}</td>
                      <td className="text-xs text-muted">{e.actor}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {entries.length < total && (
            <button
              className="btn-ghost mt-2 text-sm"
              disabled={more.busy}
              onClick={() => void more.run().catch(() => {})}
            >
              {t("journal.more")}
            </button>
          )}
          <ErrorBox error={more.error} />
        </Card>
      </div>
    </>
  );
}
