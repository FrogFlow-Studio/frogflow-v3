import { canEdit } from "@/core/auth/roles";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { receiptProductFn, writeOffFn, writeoffsFn } from "@/app/admin/warehouse.functions";
import { ProductSearch } from "@/app/admin/product-picker";
import { adminT, intlLocale } from "@/app/i18n/admin";
import { Card, ErrorBox, Field, PageTitle, useAction } from "@/app/ui";
import { formatMoney } from "@/core/money/money";

export const Route = createFileRoute("/admin/_authed/warehouse/writeoffs")({
  beforeLoad: ({ context }) => {
    if (!context.shop.modules.warehouse) throw redirect({ to: "/admin" });
  },
  loader: () => writeoffsFn({ data: { page: 0 } }),
  component: WriteoffsPage,
});

type Entry = Awaited<ReturnType<typeof writeoffsFn>>["entries"][number];
const REASONS = ["defect", "loss", "own", "other"] as const;

function WriteoffsPage() {
  const first = Route.useLoaderData();
  const { shop } = Route.useRouteContext();
  const t = adminT(shop.locale);
  const canWrite = canEdit(shop.role);
  const [entries, setEntries] = useState<Entry[]>(first.entries);
  const [total, setTotal] = useState(first.total);
  const [page, setPage] = useState(0);
  const [product, setProduct] = useState<{ id: string; name: string; stock: number | null } | null>(
    null,
  );
  const [qty, setQty] = useState("1");
  const [reason, setReason] = useState<(typeof REASONS)[number]>("defect");
  const [comment, setComment] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const reload = async () => {
    const r = await writeoffsFn({ data: { page: 0 } });
    setEntries(r.entries);
    setTotal(r.total);
    setPage(0);
  };
  const pick = useAction(async (id: string) => {
    const p = await receiptProductFn({ data: { id } });
    if (p) setProduct({ id: p.id, name: p.name, stock: p.stock });
  });
  const submit = useAction(async () => {
    if (!product) return;
    const n = Number(qty);
    if (!confirm(t("writeoff.confirm", { qty: n, name: product.name }))) return;
    setNotice(null);
    const r = await writeOffFn({ data: { productId: product.id, qty: n, reason, comment } });
    setNotice(t("writeoff.done", { qty: n, name: product.name, to: r.to }));
    setProduct(null);
    setQty("1");
    setComment("");
    await reload();
  });
  const more = useAction(async () => {
    const r = await writeoffsFn({ data: { page: page + 1 } });
    setEntries((cur) => [...cur, ...r.entries.filter((e) => !cur.some((c) => c.id === e.id))]);
    setPage(page + 1);
  });
  const when = (iso: string) =>
    new Date(iso).toLocaleString(intlLocale(shop.locale), {
      dateStyle: "short",
      timeStyle: "short",
    });
  return (
    <>
      <PageTitle
        title={t("writeoff.title")}
        subtitle={t("writeoff.subtitle")}
        actions={
          <Link to="/admin/warehouse" className="btn-ghost">
            {t("warehouse.back")}
          </Link>
        }
      />
      <div className="space-y-3">
        {canWrite && (
          <Card title={t("writeoff.form")}>
            <form
              className="grid gap-3 sm:grid-cols-2"
              onSubmit={(e) => {
                e.preventDefault();
                void submit.run().catch(() => {});
              }}
            >
              <div className="sm:col-span-2">
                <div className="label">{t("writeoff.product")}</div>
                {product ? (
                  <div className="flex items-center gap-2 rounded-md border border-line px-3 py-2 text-sm">
                    <span className="min-w-0 flex-1 truncate">
                      {product.name}
                      {product.stock !== null && (
                        <span className="ml-2 text-xs text-muted">
                          {t("receipts.stockNow", { n: product.stock })}
                        </span>
                      )}
                    </span>
                    <button
                      type="button"
                      className="btn-ghost text-xs"
                      onClick={() => setProduct(null)}
                    >
                      {t("writeoff.change")}
                    </button>
                  </div>
                ) : (
                  <ProductSearch t={t} onPick={(p) => void pick.run(p.id).catch(() => {})} />
                )}
              </div>
              <Field label={t("writeoff.qty")}>
                <input
                  className="input"
                  type="number"
                  min={1}
                  step={1}
                  required
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                />
              </Field>
              <Field label={t("writeoff.reason")}>
                <select
                  className="input"
                  value={reason}
                  onChange={(e) => setReason(e.target.value as (typeof REASONS)[number])}
                >
                  {REASONS.map((r) => (
                    <option key={r} value={r}>
                      {t(`writeoff.reason.${r}`)}
                    </option>
                  ))}
                </select>
              </Field>
              <div className="sm:col-span-2">
                <Field label={t("writeoff.comment")}>
                  <input
                    className="input"
                    maxLength={300}
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                  />
                </Field>
              </div>
              <div className="sm:col-span-2">
                <button
                  className="btn-primary"
                  disabled={submit.busy || !product || !(Number(qty) >= 1)}
                >
                  {t("writeoff.submit")}
                </button>
              </div>
            </form>
            <ErrorBox error={pick.error ?? submit.error} />
            {notice && <p className="mt-2 text-sm text-ok">{notice}</p>}
          </Card>
        )}
        <Card title={t("writeoff.history")}>
          {entries.length === 0 ? (
            <p className="text-sm text-muted">{t("writeoff.empty")}</p>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {entries.map((e) => (
                <li key={e.id} className="py-2">
                  <div>
                    <span className="font-medium">{e.name}</span> — {e.qty}{" "}
                    {e.reason ? `· ${t(`writeoff.reason.${e.reason}`)}` : ""}
                  </div>
                  {e.comment && <div className="text-xs text-muted">{e.comment}</div>}
                  <div className="text-xs text-muted">
                    {when(e.at)} ·{" "}
                    {e.unitCost === null || !e.currency
                      ? t("writeoff.noCost")
                      : t("writeoff.unitCost", { cost: formatMoney(e.unitCost, e.currency) })}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {entries.length < total && (
            <button
              className="btn-ghost mt-2 text-sm"
              disabled={more.busy}
              onClick={() => void more.run().catch(() => {})}
            >
              {t("writeoff.more")}
            </button>
          )}
          <ErrorBox error={more.error} />
        </Card>
      </div>
    </>
  );
}
