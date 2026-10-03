import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { ErrorBox, useAction } from "@/app/ui";
import type { ReorderPlan } from "@/core/storefront/reorder";
import { useCart } from "./cart";
import { useStorefrontLocale } from "./locale";
import { reorderNotes } from "./reorder-notes";

/**
 * «Повторить заказ»: просит у сервера план (что можно взять сегодня), кладёт
 * его в корзину витрины и говорит, чего не вышло и почему. В корзину не
 * переходит сам — иначе пояснения про снятые товары никто не увидит.
 */
export function ReorderButton({ slug, plan }: { slug: string; plan: () => Promise<ReorderPlan> }) {
  const { t } = useStorefrontLocale();
  const cart = useCart();
  const [result, setResult] = useState<{ added: number; notes: string[] } | null>(null);
  const go = useAction(async () => {
    const p = await plan();
    const { added, mixed } = cart.addMany(p.lines);
    setResult({
      added: added.length,
      notes: reorderNotes(
        p.skipped,
        mixed.map((l) => l.name),
        t,
      ),
    });
  });
  return (
    <div className="mt-2 space-y-1">
      <button
        type="button"
        disabled={go.busy}
        onClick={() => void go.run().catch(() => {})}
        className="rounded-md border border-line px-3 py-1 text-xs hover:bg-surface-2 disabled:opacity-50"
      >
        {t("reorder.button")}
      </button>
      <ErrorBox error={go.error} />
      {result && (
        <div className="space-y-1 text-xs">
          <p className={result.added ? "text-fg" : "text-muted"}>
            {result.added ? t("reorder.done", { n: result.added }) : t("reorder.nothing")}
          </p>
          {result.notes.map((n, i) => (
            <p key={i} className="text-muted">
              {n}
            </p>
          ))}
          {result.added > 0 && (
            <Link to="/s/$slug/cart" params={{ slug }} className="text-accent hover:underline">
              {t("reorder.toCart")}
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
