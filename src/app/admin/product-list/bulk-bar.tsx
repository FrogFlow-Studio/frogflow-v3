import { useState } from "react";
import { type AdminT } from "@/app/i18n/admin";
import type { BulkAction } from "@/core/catalog/bulk";
import { STALE_OFFER_MAX } from "@/core/stock/stale-const";
import { TopicBulk } from "@/app/admin/topic-field";

/** Панель массовых действий над выбранными товарами. */

/** Панель над списком: что сделать с выбранными товарами. */
export function BulkBar({
  t,
  n,
  total,
  picking,
  onPickAll,
  onOffer,
  categories,
  topics,
  stockOn,
  busy,
  onClear,
  onRun,
}: {
  t: AdminT;
  n: number;
  total: number;
  picking: boolean;
  onPickAll: () => void;
  onOffer: () => void;
  categories: Array<{ id: string; name: string }>;
  topics: readonly string[];
  stockOn: boolean;
  busy: boolean;
  onClear: () => void;
  onRun: (a: BulkAction) => void;
}) {
  const [category, setCategory] = useState("");
  const [percent, setPercent] = useState("");
  const pct = Number(percent.replace(",", "."));
  const pctOk = percent.trim() !== "" && Number.isFinite(pct) && pct !== 0;
  const [stock, setStock] = useState("");
  const qty = Number(stock.replace(",", "."));
  const qtyOk = stock.trim() !== "" && Number.isInteger(qty) && qty >= 0;
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-line p-3 text-sm">
      <b>{t("products.bulk.selectedOf", { n, total })}</b>
      <button type="button" className="btn-ghost" onClick={onClear}>
        {t("products.bulk.clear")}
      </button>
      {n < total && (
        <button type="button" className="btn-secondary" disabled={picking} onClick={onPickAll}>
          {t("products.bulk.pickFilter", { n: total })}
        </button>
      )}
      <button
        type="button"
        className="btn-secondary"
        disabled={busy || n > STALE_OFFER_MAX}
        title={
          n > STALE_OFFER_MAX ? t("products.bulk.offerMax", { max: STALE_OFFER_MAX }) : undefined
        }
        onClick={onOffer}
      >
        {t("products.bulk.offer")}
      </button>
      {n > STALE_OFFER_MAX && (
        <span className="text-xs text-muted">
          {t("products.bulk.offerMax", { max: STALE_OFFER_MAX })}
        </span>
      )}
      <button
        type="button"
        className="btn-secondary"
        disabled={busy}
        onClick={() => onRun({ kind: "active", active: true })}
      >
        {t("products.bulk.show")}
      </button>
      <button
        type="button"
        className="btn-secondary"
        disabled={busy}
        onClick={() => onRun({ kind: "active", active: false })}
      >
        {t("products.bulk.hide")}
      </button>
      <select
        className="input w-48"
        aria-label={t("products.bulk.categoryPick")}
        value={category}
        onChange={(e) => setCategory(e.target.value)}
      >
        <option value="">{t("products.bulk.categoryPick")}</option>
        <option value="none">{t("products.bulk.categoryNone")}</option>
        {categories.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <button
        type="button"
        className="btn-secondary"
        disabled={busy || !category || category === "none"}
        onClick={() => onRun({ kind: "category", categoryId: category, mode: "add" })}
      >
        {t("products.bulk.categoryAdd")}
      </button>
      <button
        type="button"
        className="btn-secondary"
        disabled={busy || !category}
        onClick={() =>
          onRun({
            kind: "category",
            categoryId: category === "none" ? null : category,
            mode: "set",
          })
        }
      >
        {t("products.bulk.categorySet")}
      </button>
      <input
        className="input w-44"
        inputMode="decimal"
        placeholder={t("products.bulk.percent")}
        aria-label={t("products.bulk.percent")}
        value={percent}
        onChange={(e) => setPercent(e.target.value)}
      />
      <button
        type="button"
        className="btn-secondary"
        disabled={busy || !pctOk}
        onClick={() => onRun({ kind: "price", percent: pct })}
      >
        {t("products.bulk.priceApply")}
      </button>
      {stockOn && (
        <>
          <input
            className="input w-28"
            inputMode="numeric"
            placeholder={t("products.bulk.stockAmount")}
            aria-label={t("products.bulk.stockAmount")}
            value={stock}
            onChange={(e) => setStock(e.target.value)}
          />
          <button
            type="button"
            className="btn-secondary"
            disabled={busy || !qtyOk}
            onClick={() => onRun({ kind: "stock", mode: "set", amount: qty })}
          >
            {t("products.bulk.stockSet")}
          </button>
          <button
            type="button"
            className="btn-secondary"
            disabled={busy || !qtyOk || qty < 1}
            onClick={() => onRun({ kind: "stock", mode: "add", amount: qty })}
          >
            {t("products.bulk.stockAdd")}
          </button>
        </>
      )}
      <TopicBulk t={t} existing={topics} busy={busy} onRun={onRun} />
    </div>
  );
}
