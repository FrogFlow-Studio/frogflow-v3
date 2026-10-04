import { canEdit } from "@/core/auth/roles";
import { createFileRoute, Link, redirect, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import {
  deleteReceiptFn,
  postReceiptFn,
  receiptProductFn,
  receiptsFn,
  saveReceiptFn,
} from "@/app/admin/warehouse.functions";
import { ProductSearch } from "@/app/admin/product-picker";
import { adminT, intlLocale, type AdminT } from "@/app/i18n/admin";
import { Badge, Card, ErrorBox, Field, PageTitle, useAction } from "@/app/ui";
import { formatMoney } from "@/core/money/money";

export const Route = createFileRoute("/admin/_authed/warehouse/receipts")({
  beforeLoad: ({ context }) => {
    if (!context.shop.modules.warehouse) throw redirect({ to: "/admin" });
  },
  loader: () => receiptsFn(),
  component: ReceiptsPage,
});

type Data = Awaited<ReturnType<typeof receiptsFn>>;
type Receipt = Data["receipts"][number];
type Line = {
  productId: string;
  name: string;
  variants: string[];
  stock: number | null;
  variant: string;
  qty: string;
  price: string;
};
type Draft = { id: string | null; supplierId: string; updateCost: boolean; lines: Line[] };

const TONE = {
  draft: "neutral",
  posting: "warn",
  partial: "warn",
  posted: "ok",
} as const;

function ReceiptsPage() {
  const data = Route.useLoaderData();
  const { shop } = Route.useRouteContext();
  const t = adminT(shop.locale);
  const canWrite = canEdit(shop.role);
  const router = useRouter();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const supplierName = (id: string | null) =>
    data.suppliers.find((s) => s.id === id)?.name ?? t("receipts.noSupplier");
  const act = useAction(async (fn: () => Promise<unknown>) => {
    setNotice(null);
    try {
      await fn();
    } finally {
      await router.invalidate();
    }
  });
  const run = (fn: () => Promise<unknown>) => void act.run(fn).catch(() => {});
  const post = (r: Receipt) => {
    if (!confirm(t("receipts.postConfirm", { no: r.no }))) return;
    run(async () => {
      const res = await postReceiptFn({ data: { id: r.id } });
      setNotice(
        res.skipped
          ? t("receipts.postedSkipped", { no: res.no, n: res.skipped })
          : t("receipts.posted", { no: res.no }),
      );
    });
  };
  const open = (r: Receipt) =>
    setDraft({
      id: r.id,
      supplierId: r.supplierId ?? "",
      updateCost: r.updateCost,
      lines: r.lines.map((l) => ({
        productId: l.productId,
        name: l.name,
        variants: l.variant ? [l.variant] : [],
        stock: null,
        variant: l.variant ?? "",
        qty: String(l.qty),
        price: String(l.price),
      })),
    });
  const when = (iso: string) =>
    new Date(iso).toLocaleDateString(intlLocale(shop.locale), { dateStyle: "short" });
  return (
    <>
      <PageTitle
        title={t("receipts.title")}
        subtitle={t("receipts.subtitle")}
        actions={
          <>
            <Link to="/admin/warehouse" className="btn-ghost">
              {t("warehouse.back")}
            </Link>
            {canWrite && !draft && (
              <button
                className="btn-primary"
                onClick={() => setDraft({ id: null, supplierId: "", updateCost: false, lines: [] })}
              >
                {t("receipts.new")}
              </button>
            )}
          </>
        }
      />
      <div className="space-y-3">
        <ErrorBox error={act.error} />
        {notice && <p className="text-sm text-ok">{notice}</p>}
        {draft && (
          <ReceiptEditor
            t={t}
            data={data}
            draft={draft}
            setDraft={setDraft}
            busy={act.busy}
            onCancel={() => setDraft(null)}
            onSave={(d) =>
              run(async () => {
                await saveReceiptFn({
                  data: {
                    id: d.id,
                    supplierId: d.supplierId || null,
                    updateCost: d.updateCost,
                    lines: d.lines.map((l) => ({
                      productId: l.productId,
                      variant: l.variant || null,
                      qty: Number(l.qty),
                      price: Number(l.price.replace(",", ".")),
                    })),
                  },
                });
                setDraft(null);
              })
            }
          />
        )}
        {data.receipts.length === 0 && !draft && (
          <p className="text-sm text-muted">{t("receipts.empty")}</p>
        )}
        {data.receipts.map((r) => (
          <Card
            key={r.id}
            title={`${t("receipts.no", { no: r.no })} · ${supplierName(r.supplierId)}`}
            actions={
              <Badge tone={TONE[r.status as keyof typeof TONE] ?? "neutral"}>
                {t(`receipts.status.${r.status as "draft"}`)}
              </Badge>
            }
          >
            <div className="space-y-1 text-sm">
              <div className="text-xs text-muted">{when(r.postedAt ?? r.createdAt)}</div>
              {r.status === "partial" && (
                <p className="text-xs text-warn">{t("receipts.partialHint")}</p>
              )}
              <ul className="space-y-0.5">
                {r.lines.map((l, i) => (
                  <li key={i}>
                    {l.name}
                    {l.variant ? ` · ${l.variant}` : ""} — {l.qty} ×{" "}
                    {formatMoney(l.price, shop.currency)}
                    {l.state === "skipped" && (
                      <span className="ml-1 text-xs text-warn">{t("receipts.lineSkipped")}</span>
                    )}
                    {l.costFailed && (
                      <span className="ml-1 text-xs text-warn">{t("receipts.costFailed")}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
            {canWrite && r.status !== "posted" && r.status !== "posting" && !draft && (
              <div className="mt-3 flex flex-wrap gap-2">
                {r.status === "draft" && (
                  <button className="btn-ghost text-xs" onClick={() => open(r)}>
                    {t("receipts.edit")}
                  </button>
                )}
                <button className="btn-primary text-xs" disabled={act.busy} onClick={() => post(r)}>
                  {t("receipts.post")}
                </button>
                {r.status === "draft" && (
                  <button
                    className="btn-ghost text-xs"
                    disabled={act.busy}
                    onClick={() => {
                      if (confirm(t("receipts.deleteConfirm", { no: r.no })))
                        run(() => deleteReceiptFn({ data: { id: r.id } }));
                    }}
                  >
                    {t("receipts.delete")}
                  </button>
                )}
              </div>
            )}
          </Card>
        ))}
      </div>
    </>
  );
}

function ReceiptEditor({
  t,
  data,
  draft,
  setDraft,
  busy,
  onSave,
  onCancel,
}: {
  t: AdminT;
  data: Data;
  draft: Draft;
  setDraft: (d: Draft) => void;
  busy: boolean;
  onSave: (d: Draft) => void;
  onCancel: () => void;
}) {
  const adding = useAction(async (id: string) => {
    const p = await receiptProductFn({ data: { id } });
    if (!p) return;
    setDraft({
      ...draft,
      lines: [
        ...draft.lines,
        {
          productId: p.id,
          name: p.name,
          variants: p.variants,
          stock: p.stock,
          variant: "",
          qty: "1",
          price: "",
        },
      ],
    });
  });
  const patch = (i: number, change: Partial<Line>) =>
    setDraft({ ...draft, lines: draft.lines.map((l, k) => (k === i ? { ...l, ...change } : l)) });
  const valid =
    draft.lines.length > 0 &&
    draft.lines.every(
      (l) => Number.isInteger(Number(l.qty)) && Number(l.qty) >= 1 && l.price.trim() !== "",
    );
  return (
    <Card title={draft.id ? t("receipts.edit") : t("receipts.new")}>
      <div className="space-y-3">
        <Field label={t("receipts.supplier")}>
          <select
            className="input"
            value={draft.supplierId}
            onChange={(e) => setDraft({ ...draft, supplierId: e.target.value })}
          >
            <option value="">{t("receipts.noSupplier")}</option>
            {data.suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
        <div className="space-y-2">
          <div className="label">{t("receipts.lines")}</div>
          {draft.lines.length === 0 && (
            <p className="text-sm text-muted">{t("receipts.noLines")}</p>
          )}
          {draft.lines.map((l, i) => (
            <div key={i} className="grid gap-2 rounded-md border border-line p-2 sm:grid-cols-4">
              <div className="text-sm sm:col-span-4">
                <span className="font-medium">{l.name}</span>
                {l.stock !== null && (
                  <span className="ml-2 text-xs text-muted">
                    {t("receipts.stockNow", { n: l.stock })}
                  </span>
                )}
              </div>
              <select
                className="input"
                aria-label={t("receipts.variant")}
                value={l.variant}
                disabled={l.variants.length === 0}
                onChange={(e) => patch(i, { variant: e.target.value })}
              >
                <option value="">{t("receipts.noVariant")}</option>
                {l.variants.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
              <input
                className="input"
                type="number"
                min={1}
                step={1}
                aria-label={t("receipts.qty")}
                placeholder={t("receipts.qty")}
                value={l.qty}
                onChange={(e) => patch(i, { qty: e.target.value })}
              />
              <input
                className="input"
                type="number"
                min={0}
                step="0.01"
                aria-label={t("receipts.price")}
                placeholder={t("receipts.price")}
                value={l.price}
                onChange={(e) => patch(i, { price: e.target.value })}
              />
              <button
                type="button"
                className="btn-ghost text-xs"
                onClick={() => setDraft({ ...draft, lines: draft.lines.filter((_, k) => k !== i) })}
              >
                {t("receipts.remove")}
              </button>
            </div>
          ))}
          <ProductSearch
            t={t}
            exclude={draft.lines.map((l) => l.productId)}
            onPick={(p) => void adding.run(p.id).catch(() => {})}
          />
          <ErrorBox error={adding.error} />
        </div>
        {data.profit && (
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={draft.updateCost}
              onChange={(e) => setDraft({ ...draft, updateCost: e.target.checked })}
            />
            <span>
              {t("receipts.updateCost")}
              <span className="block text-xs text-muted">{t("receipts.updateCostHint")}</span>
            </span>
          </label>
        )}
        <div className="flex gap-2">
          <button className="btn-primary" disabled={busy || !valid} onClick={() => onSave(draft)}>
            {t("receipts.saveDraft")}
          </button>
          <button className="btn-ghost" type="button" onClick={onCancel}>
            {t("receipts.cancel")}
          </button>
        </div>
      </div>
    </Card>
  );
}
