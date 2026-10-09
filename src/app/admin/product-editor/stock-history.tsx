import { useEffect, useState } from "react";
import { stockHistoryFn } from "@/app/admin/products.functions";
import { intlLocale, type AdminT } from "@/app/i18n/admin";
import { Card } from "@/app/ui";
import { LoadError } from "@/app/ui/states";
import { type Locale } from "@/core/i18n/locale";

type StockHistory = Awaited<ReturnType<typeof stockHistoryFn>>["entries"];

/** «История остатка»: куда делись штуки за 30 дней, страницами по 20. */
export function StockHistoryCard({
  productId,
  locale,
  t,
}: {
  productId: string;
  locale: Locale;
  t: AdminT;
}) {
  const [entries, setEntries] = useState<StockHistory>([]);
  const [total, setTotal] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const load = async () => {
    const page = Math.ceil(entries.length / 20);
    try {
      const r = await stockHistoryFn({ data: { productId, page } });
      setEntries((x) => [...x, ...r.entries]);
      setTotal(r.total);
      setFailed(false);
    } catch {
      setFailed(true);
    }
    setLoaded(true);
  };
  useEffect(() => {
    void load();
    // Только при открытии карточки: «Показать ещё» грузит следующую страницу.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId]);
  const amount = (n: number | null) =>
    n === null ? t("product.stockHistory.untracked") : String(n);
  const reason = (e: StockHistory[number]) => {
    const key = `product.stockHistory.reason.${e.reason}` as const;
    if (
      e.reason === "order" ||
      e.reason === "cancel" ||
      e.reason === "refund" ||
      e.reason === "manual_order" ||
      e.reason === "bundle"
    )
      return e.orderNo === null
        ? t("product.stockHistory.reason.orderGone")
        : t(key, { no: e.orderNo });
    if (e.reason === "receipt") return t(key, { no: e.receiptNo ?? "?" });
    return t(key);
  };
  return (
    <Card title={t("product.card.stockHistory")}>
      <p className="mb-2 text-xs text-muted">{t("product.stockHistory.hint")}</p>
      {failed && (
        <LoadError message={t("product.stockHistory.failed")} onRetry={() => void load()} />
      )}
      {loaded && !failed && entries.length === 0 && (
        <p className="text-sm text-muted">{t("product.stockHistory.empty")}</p>
      )}
      <ul className="space-y-1 text-sm">
        {entries.map((e) => (
          <li key={e.id} className="flex flex-wrap items-baseline justify-between gap-2">
            <span>
              {reason(e)}
              {e.actor.startsWith("admin:") && e.actor.length > 6 && (
                <span className="text-xs text-muted">
                  {" · "}
                  {t("product.stockHistory.by", { who: e.actor.slice(6) })}
                </span>
              )}
            </span>
            <span className="whitespace-nowrap">
              <span className="text-xs text-muted">
                {new Date(e.at).toLocaleString(intlLocale(locale), {
                  day: "numeric",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                })}{" "}
              </span>
              {amount(e.from)} → <b>{amount(e.to)}</b>
            </span>
          </li>
        ))}
      </ul>
      {entries.length < total && (
        <button type="button" className="btn-ghost mt-2 text-xs" onClick={() => void load()}>
          {t("product.stockHistory.more")}
        </button>
      )}
    </Card>
  );
}
