import { getRouteApi } from "@tanstack/react-router";
import { ProductPicker, type PickerProduct } from "@/app/admin/product-picker";
import { useEffect, useState } from "react";
import { offerQueueFn } from "@/app/admin/stock-reports.functions";
import {
  announceOfferFn,
  deleteOfferFn,
  endOfferFn,
  offersFn,
  saveOfferFn,
} from "@/app/admin/offers.functions";
import { adminT, intlLocale } from "@/app/i18n/admin";
import { Badge, Card, ErrorBox, useAction } from "@/app/ui";
import { utcToZonedLocal } from "@/core/export/csv";

/** Контекст и поиск страницы скидок: компонент вынесен из файла маршрута. */
const Route = getRouteApi("/admin/_authed/discounts");

/** Акции на товары. */

/** Ограниченные предложения: скидка на товар до даты и, по желанию, на N штук. */
export function OffersCard() {
  const { shop } = Route.useRouteContext();
  const t = adminT(shop.locale);
  const loc = intlLocale(shop.locale);
  const [data, setData] = useState<Awaited<ReturnType<typeof offersFn>> | null>(null);
  const [editId, setEditId] = useState<string | undefined>(undefined);
  const [scope, setScope] = useState<"product" | "category">("product");
  const [mode, setMode] = useState<"percent" | "price">("percent");
  const [product, setProduct] = useState<PickerProduct | null>(null);
  const [categoryId, setCategoryId] = useState("");
  const [percent, setPercent] = useState("20");
  const [newPrice, setNewPrice] = useState("");
  const [starts, setStarts] = useState("");
  const [ends, setEnds] = useState("");
  const [limit, setLimit] = useState("");
  const reload = async () => setData(await offersFn());
  useEffect(() => {
    void reload();
  }, []);
  // Очередь товаров из отчёта «Залежавшийся товар»: форма берёт их по одному.
  const { offerProducts } = Route.useSearch();
  const [queue, setQueue] = useState<PickerProduct[]>([]);
  useEffect(() => {
    const ids = (offerProducts ?? "")
      .split(",")
      .filter((x) => /^[0-9a-f-]{36}$/i.test(x))
      .slice(0, 20);
    if (!ids.length) return;
    void offerQueueFn({ data: { ids } })
      .then((list) => {
        setQueue(list);
        setScope("product");
        setProduct(list[0] ?? null);
      })
      .catch(() => {});
  }, [offerProducts]);
  const reset = () => {
    setEditId(undefined);
    setProduct(null);
    setCategoryId("");
    setNewPrice("");
    setStarts("");
    setEnds("");
    setLimit("");
    setMode("percent");
    setScope("product");
  };
  const add = useAction(async () => {
    await saveOfferFn({
      data: {
        id: editId,
        scope,
        productId: scope === "product" ? product?.id : undefined,
        categoryId: scope === "category" ? categoryId : undefined,
        mode,
        percent: mode === "percent" ? Number(percent) : undefined,
        newPrice: mode === "price" ? Number(newPrice) : undefined,
        startsAt: starts || null,
        endsAt: ends,
        limit: scope === "product" && limit.trim() ? Number(limit) : null,
      },
    });
    // Следующий товар из очереди: скидка и сроки остаются, меняется только товар.
    if (!editId && queue.length > 1) {
      setQueue(queue.slice(1));
      setProduct(queue[1] ?? null);
    } else {
      setQueue([]);
      reset();
    }
    await reload();
  });
  const del = useAction(async (id: string) => {
    await deleteOfferFn({ data: { id } });
    await reload();
  });
  const announce = useAction(async (id: string) => {
    if (!confirm(t("discounts.offers.announceConfirm"))) return;
    await announceOfferFn({ data: { id } });
    await reload();
  });
  const end = useAction(async (id: string) => {
    if (!confirm(t("discounts.offers.endConfirm"))) return;
    await endOfferFn({ data: { id } });
    await reload();
  });
  const name = new Map((data?.products ?? []).map((p) => [p.id, p.name]));
  const catName = new Map((data?.categories ?? []).map((c) => [c.id, c.name]));
  const tz = data?.timezone ?? "UTC";
  const now = Date.now();
  const edit = (o: NonNullable<typeof data>["offers"][number]) => {
    setEditId(o.id);
    setScope(o.category_id ? "category" : "product");
    setMode(o.new_price != null ? "price" : "percent");
    setProduct(
      o.product_id
        ? ({ id: o.product_id, name: name.get(o.product_id) ?? "" } as PickerProduct)
        : null,
    );
    setCategoryId(o.category_id ?? "");
    setPercent(String(o.percent));
    setNewPrice(o.new_price != null ? String(o.new_price) : "");
    setStarts(utcToZonedLocal(o.starts_at, tz));
    setEnds(utcToZonedLocal(o.ends_at, tz));
    setLimit(o.limit != null ? String(o.limit) : "");
  };
  const when = (iso: string) =>
    new Date(iso).toLocaleString(loc, { dateStyle: "short", timeStyle: "short", timeZone: tz });
  return (
    <Card title={t("discounts.offers.title")} className="lg:col-span-2">
      <p className="mb-3 text-sm text-muted">{t("discounts.offers.intro")}</p>
      {queue.length > 0 && (
        <p className="mb-3 rounded border border-line bg-surface-2 p-2 text-sm">
          {t("discounts.offers.queue", { n: queue.length })}
        </p>
      )}
      <form
        className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4"
        onSubmit={(e) => {
          e.preventDefault();
          void add.run().catch(() => {});
        }}
      >
        <select
          className="input"
          aria-label={t("discounts.offers.scope")}
          value={scope}
          onChange={(e) => {
            setScope(e.target.value as "product" | "category");
            if (e.target.value === "category") setMode("percent");
          }}
        >
          <option value="product">{t("discounts.offers.scopeProduct")}</option>
          <option value="category">{t("discounts.offers.scopeCategory")}</option>
        </select>
        {scope === "product" ? (
          <div aria-label={t("discounts.offers.product")}>
            <ProductPicker t={t} value={product} onChange={setProduct} />
          </div>
        ) : (
          <select
            className="input"
            aria-label={t("discounts.offers.category")}
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            required
          >
            <option value="">{t("discounts.offers.category")}</option>
            {(data?.categories ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}
        <select
          className="input"
          aria-label={t("discounts.offers.mode")}
          value={mode}
          disabled={scope === "category"}
          onChange={(e) => setMode(e.target.value as "percent" | "price")}
        >
          <option value="percent">{t("discounts.offers.modePercent")}</option>
          <option value="price">{t("discounts.offers.modePrice")}</option>
        </select>
        {mode === "percent" ? (
          <input
            className="input"
            type="number"
            min={1}
            max={99}
            value={percent}
            onChange={(e) => setPercent(e.target.value)}
            placeholder="%"
            aria-label="%"
            required
          />
        ) : (
          <input
            className="input"
            type="number"
            min={1}
            step="any"
            value={newPrice}
            onChange={(e) => setNewPrice(e.target.value)}
            placeholder={t("discounts.offers.newPrice")}
            aria-label={t("discounts.offers.newPrice")}
            required
          />
        )}
        <label className="text-xs text-muted">
          {t("discounts.offers.from")}
          <input
            className="input"
            type="datetime-local"
            value={starts}
            onChange={(e) => setStarts(e.target.value)}
          />
        </label>
        <label className="text-xs text-muted">
          {t("discounts.offers.until")}
          <input
            className="input"
            type="datetime-local"
            value={ends}
            onChange={(e) => setEnds(e.target.value)}
            required
          />
        </label>
        <input
          className="input self-end"
          type="number"
          min={1}
          value={limit}
          disabled={scope === "category"}
          onChange={(e) => setLimit(e.target.value)}
          placeholder={t("discounts.offers.limit")}
          aria-label={t("discounts.offers.limit")}
        />
        <div className="flex gap-2 self-end">
          <button
            className="btn-primary"
            disabled={add.busy || (scope === "product" ? !product : !categoryId)}
          >
            {editId ? t("discounts.offers.save") : t("discounts.offers.add")}
          </button>
          {editId && (
            <button type="button" className="btn-secondary" onClick={reset}>
              {t("common.cancel")}
            </button>
          )}
        </div>
      </form>
      <p className="mt-2 text-xs text-muted">
        {t("discounts.offers.tz")} {tz}
      </p>
      <ErrorBox error={add.error ?? del.error ?? end.error ?? announce.error} />
      {data && data.offers.length === 0 && (
        <p className="mt-3 text-sm text-muted">{t("discounts.offers.empty")}</p>
      )}
      {data && data.offers.length > 0 && (
        <table className="table mt-3">
          <thead>
            <tr>
              <th>{t("discounts.offers.product")}</th>
              <th>{t("discounts.offers.discount")}</th>
              <th>{t("discounts.offers.period")}</th>
              <th>{t("discounts.offers.sold")}</th>
              <th>{t("discounts.col.status")}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {data.offers.map((o) => {
              const running =
                Date.parse(o.starts_at) <= now && now < Date.parse(o.ends_at) && (o.left ?? 1) > 0;
              const planned = Date.parse(o.starts_at) > now;
              return (
                <tr key={o.id}>
                  <td>
                    {o.category_id
                      ? `${t("discounts.offers.scopeCategory")}: ${catName.get(o.category_id) ?? "—"}`
                      : (name.get(o.product_id) ?? "—")}
                  </td>
                  <td className="tabular-nums">
                    {o.new_price != null ? `${o.new_price} (−${o.percent}%)` : `−${o.percent}%`}
                  </td>
                  <td className="text-muted">
                    {when(o.starts_at)} — {when(o.ends_at)}
                  </td>
                  <td className="tabular-nums">
                    {o.category_id ? "—" : o.sold}
                    {o.limit != null && ` / ${o.limit}`}
                  </td>
                  <td>
                    {running ? (
                      <Badge tone="ok">{t("discounts.offers.running")}</Badge>
                    ) : planned ? (
                      <Badge>{t("discounts.offers.planned")}</Badge>
                    ) : (
                      <Badge>{t("discounts.offers.ended")}</Badge>
                    )}
                  </td>
                  <td className="text-right whitespace-nowrap">
                    <button className="btn-ghost text-xs" onClick={() => edit(o)}>
                      {t("common.edit")}
                    </button>
                    {(running || planned) && shop.modules.broadcasts && !o.announced_at && (
                      <button
                        className="btn-ghost text-xs"
                        disabled={announce.busy}
                        onClick={() => void announce.run(o.id).catch(() => {})}
                      >
                        {t("discounts.offers.announce")}
                      </button>
                    )}
                    {o.announced_at && <Badge>{t("discounts.offers.announced")}</Badge>}
                    {(running || planned) && (
                      <button
                        className="btn-ghost text-xs"
                        disabled={end.busy}
                        onClick={() => void end.run(o.id).catch(() => {})}
                      >
                        {t("discounts.offers.end")}
                      </button>
                    )}
                    <button
                      className="btn-ghost text-xs text-danger"
                      disabled={del.busy}
                      onClick={() => void del.run(o.id).catch(() => {})}
                    >
                      {t("common.delete")}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </Card>
  );
}
