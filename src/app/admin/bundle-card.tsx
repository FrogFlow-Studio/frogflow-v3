import { useEffect, useState } from "react";
import {
  bundleComponentFn,
  productBundleFn,
  saveProductBundleFn,
} from "@/app/admin/bundle.functions";
import { ProductSearch } from "@/app/admin/product-picker";
import type { AdminT } from "@/app/i18n/admin";
import { Card, ErrorBox, useAction } from "@/app/ui";
import { BUNDLE_MAX_ITEMS } from "@/core/bundles/limits";
import { formatMoney } from "@/core/money/money";

type View = Awaited<ReturnType<typeof productBundleFn>>["view"];
type Row = {
  productId: string;
  variantId: string | null;
  qty: number;
  name: string | null;
  variantName: string | null;
  state: "ok" | "hidden" | "deleted" | "noVariant";
};
type Pending = { id: string; name: string; variants: Array<{ id: string; name: string }> };

const toRows = (view: NonNullable<View>): Row[] =>
  view.items.map((i) => ({
    productId: i.productId,
    variantId: i.variantId,
    qty: i.qty,
    name: i.name,
    variantName: i.variantName,
    state: i.state,
  }));

/**
 * «Это набор»: состав набора в карточке товара (core/bundles). Набор — обычный
 * товар со своей ценой; здесь — из чего он состоит и сколько выгадывает покупатель.
 */
export function BundleCard({ productId, t }: { productId: string; t: AdminT }) {
  const [loaded, setLoaded] = useState(false);
  const [view, setView] = useState<View>(null);
  const [on, setOn] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [pending, setPending] = useState<Pending | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    void productBundleFn({ data: { id: productId } }).then((r) => {
      setView(r.view);
      setOn(r.view !== null);
      setRows(r.view ? toRows(r.view) : []);
      setLoaded(true);
    });
  }, [productId]);
  const save = useAction(async (items: Row[] | null) => {
    setSaved(false);
    const r = await saveProductBundleFn({
      data: {
        id: productId,
        items:
          items?.map((i) => ({ productId: i.productId, variantId: i.variantId, qty: i.qty })) ??
          null,
      },
    });
    setView(r.view);
    setOn(r.view !== null);
    setRows(r.view ? toRows(r.view) : []);
    setSaved(true);
  });
  const pick = useAction(async (id: string) => {
    setNote(null);
    const { component } = await bundleComponentFn({ data: { id } });
    if (!component) return;
    if (!component.physical) {
      setNote(t("bundle.notPhysical", { name: component.name }));
      return;
    }
    if (component.variants.length) {
      setPending({ id: component.id, name: component.name, variants: component.variants });
      return;
    }
    add({ productId: id, variantId: null, name: component.name, variantName: null });
  });
  const add = (x: Pick<Row, "productId" | "variantId" | "name" | "variantName">) =>
    setRows((cur) =>
      cur.some((r) => r.productId === x.productId && r.variantId === x.variantId) ||
      cur.length >= BUNDLE_MAX_ITEMS
        ? cur
        : [...cur, { ...x, qty: 1, state: "ok" }],
    );
  if (!loaded) return null;
  const money = (n: number) => formatMoney(n, view?.currency ?? "KZT");
  return (
    <Card title={t("bundle.card")}>
      <p className="mb-3 text-xs text-muted">{t("bundle.hint")}</p>
      <label className="mb-3 flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={on}
          disabled={save.busy}
          onChange={(e) => {
            if (e.target.checked) setOn(true);
            else if (view) void save.run(null).catch(() => {});
            else {
              setOn(false);
              setRows([]);
            }
          }}
        />
        {t("bundle.on")}
      </label>
      {on && (
        <>
          <ul className="mb-2 space-y-1 text-sm">
            {rows.map((r) => (
              <li
                key={`${r.productId}:${r.variantId ?? ""}`}
                className="flex flex-wrap items-center justify-between gap-2"
              >
                <span className="min-w-0 truncate">
                  {r.name ?? t("bundle.deletedName")}
                  {r.variantName ? ` · ${r.variantName}` : ""}
                  {r.state !== "ok" && (
                    <span className="ml-2 text-xs text-warn">{t(`bundle.state.${r.state}`)}</span>
                  )}
                </span>
                <span className="flex items-center gap-2">
                  <input
                    className="input w-20"
                    type="number"
                    min={1}
                    max={99}
                    aria-label={t("bundle.qty")}
                    value={r.qty}
                    onChange={(e) => {
                      const qty = Math.max(
                        1,
                        Math.min(99, Math.floor(Number(e.target.value)) || 1),
                      );
                      setRows((cur) =>
                        cur.map((x) =>
                          x.productId === r.productId && x.variantId === r.variantId
                            ? { ...x, qty }
                            : x,
                        ),
                      );
                    }}
                  />
                  <button
                    type="button"
                    className="btn-ghost text-xs"
                    aria-label={t("bundle.remove")}
                    onClick={() =>
                      setRows((cur) =>
                        cur.filter(
                          (x) => !(x.productId === r.productId && x.variantId === r.variantId),
                        ),
                      )
                    }
                  >
                    ✕
                  </button>
                </span>
              </li>
            ))}
          </ul>
          {rows.length === 0 && <p className="mb-2 text-xs text-muted">{t("bundle.empty")}</p>}
          {pending ? (
            <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
              <span>{pending.name}</span>
              <select
                className="input w-auto"
                aria-label={t("bundle.variant")}
                defaultValue=""
                onChange={(e) => {
                  const v = pending.variants.find((x) => x.id === e.target.value);
                  if (!v) return;
                  add({
                    productId: pending.id,
                    variantId: v.id,
                    name: pending.name,
                    variantName: v.name,
                  });
                  setPending(null);
                }}
              >
                <option value="" disabled>
                  {t("bundle.pickVariant")}
                </option>
                {pending.variants.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
              <button type="button" className="btn-ghost text-xs" onClick={() => setPending(null)}>
                ✕
              </button>
            </div>
          ) : (
            rows.length < BUNDLE_MAX_ITEMS && (
              <div aria-label={t("bundle.addLabel")}>
                <ProductSearch
                  t={t}
                  exclude={[productId]}
                  onPick={(x) => void pick.run(x.id).catch(() => {})}
                />
              </div>
            )
          )}
          {note && <p className="mt-2 text-xs text-warn">{note}</p>}
          <div className="mt-3 flex items-center gap-3">
            <button
              type="button"
              className="btn-secondary"
              disabled={save.busy || rows.length === 0}
              onClick={() => void save.run(rows).catch(() => {})}
            >
              {t("common.save")}
            </button>
            {saved && <span className="text-xs text-ok">{t("bundle.saved")}</span>}
          </div>
          {view && !view.available && (
            <p className="mt-2 text-xs text-warn">{t("bundle.unavailable")}</p>
          )}
          {view && view.saving !== null && view.separateTotal !== null && (
            <p className="mt-2 text-sm">
              {t(view.saving > 0 ? "bundle.saving" : "bundle.noSaving", {
                sum: money(view.separateTotal),
                saving: money(Math.max(0, view.saving)),
              })}
            </p>
          )}
          {view && view.stock !== null && (
            <p className="mt-2 text-sm">{t("bundle.stock", { n: String(view.stock) })}</p>
          )}
          {view && view.available && view.saving === null && (
            <p className="mt-2 text-xs text-muted">{t("bundle.noCompare")}</p>
          )}
        </>
      )}
      <ErrorBox error={save.error ?? pick.error} />
    </Card>
  );
}
