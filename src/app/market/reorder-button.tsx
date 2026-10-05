import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { reorderNotes } from "@/app/storefront/reorder-notes";
import { mergeCartLines } from "@/app/storefront/cart-merge";
import { storefrontT } from "@/app/i18n/storefront";
import type { Locale } from "@/core/i18n/locale";
import { marketReorderFn } from "./buyer.functions";
import { reorderT } from "./reorder-i18n";

/**
 * «Заказать снова» (К3): сервер отдаёт план по сегодняшним ценам и остаткам, позиции ложатся
 * в корзину этого магазина (она живёт в браузере, `ff-cart-<магазин>`), заказ не оформляется.
 * Недоступное показано строками под кнопкой; в корзину покупатель переходит сам.
 */
export function MarketReorderButton({
  slug,
  orderId,
  locale,
}: {
  slug: string;
  orderId: number;
  locale: Locale;
}) {
  const t = reorderT(locale);
  const st = storefrontT(locale);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ added: number; notes: string[] } | null>(null);
  const [failed, setFailed] = useState(false);
  const go = async () => {
    setBusy(true);
    setFailed(false);
    try {
      const r = await marketReorderFn({ data: { slug, orderId } });
      if (r.status !== "ok") {
        setFailed(true);
        return;
      }
      const key = `ff-cart-${slug}`;
      let current: Parameters<typeof mergeCartLines>[0] = [];
      try {
        const raw = localStorage.getItem(key);
        if (raw) current = JSON.parse(raw);
      } catch {
        /* корзина пуста или недоступна */
      }
      const merged = mergeCartLines(current, r.plan.lines);
      if (merged.added.length) {
        try {
          localStorage.setItem(key, JSON.stringify(merged.lines));
        } catch {
          setFailed(true);
          return;
        }
      }
      setResult({
        added: merged.added.length,
        notes: reorderNotes(
          r.plan.skipped,
          merged.mixed.map((l) => l.name),
          st,
        ),
      });
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mt-1">
      <button
        type="button"
        disabled={busy}
        onClick={() => void go()}
        className="rounded-md border border-line px-3 py-1 text-xs hover:bg-surface-2 disabled:opacity-50"
      >
        {t("button")}
      </button>
      {failed && (
        <p role="status" className="mt-1 text-xs text-muted">
          {t("failed")}
        </p>
      )}
      {result && (
        <div role="status" className="mt-1 space-y-1 text-xs">
          <p className={result.added ? "" : "text-muted"}>
            {result.added ? st("reorder.done", { n: result.added }) : st("reorder.nothing")}
          </p>
          {result.notes.map((n, i) => (
            <p key={i} className="text-muted">
              {n}
            </p>
          ))}
          {result.added > 0 && (
            <Link to="/s/$slug/cart" params={{ slug }} className="underline">
              {st("reorder.toCart")}
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
