import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { miniAppOrdersFn } from "@/app/storefront/storefront.functions";
import { useTelegramWebApp } from "@/app/storefront/cart";
import { useStorefrontLocale } from "@/app/storefront/locale";
import { formatMoney } from "@/core/money/money";
import { Empty, ErrorBox } from "@/app/ui";
import { intlLocale } from "@/app/i18n/admin";
import { ordersView } from "@/core/storefront/tabs";

export const Route = createFileRoute("/s/$slug/orders")({
  validateSearch: (s: Record<string, unknown>): { tab?: "library" | "orders" } => {
    const v = ordersView(s.tab);
    return v === "all" ? {} : { tab: v };
  },
  component: OrdersPage,
});

type Data = Awaited<ReturnType<typeof miniAppOrdersFn>>;

/** Mini App: мои заказы и библиотека выданных материалов — только внутри Telegram. */
function OrdersPage() {
  const { slug } = Route.useParams();
  const view = ordersView(Route.useSearch().tab);
  const showOrders = view !== "library";
  const showLibrary = view !== "orders";
  const { t, locale } = useStorefrontLocale();
  const wa = useTelegramWebApp();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [checked, setChecked] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setChecked(true), 300);
    return () => clearTimeout(timer);
  }, []);
  const [loadingMore, setLoadingMore] = useState(false);
  const manyLangs =
    Boolean(data?.libraryLangs) && new Set(data?.library.map((f) => f.lang)).size > 1;
  useEffect(() => {
    if (!wa) return;
    miniAppOrdersFn({ data: { slug, initData: wa.initData } }).then(setData, setError);
  }, [wa, slug]);
  // Библиотека листается страницами: у постоянного покупателя вся история за
  // раз не соберётся (водяной знак и подпись ссылки на каждый файл).
  const loadMore = () => {
    if (!wa || !data?.libraryNext) return;
    setLoadingMore(true);
    miniAppOrdersFn({ data: { slug, initData: wa.initData, libraryOffset: data.libraryNext } })
      .then(
        (next) =>
          setData((cur) =>
            cur
              ? {
                  ...cur,
                  library: [...cur.library, ...next.library],
                  libraryNext: next.libraryNext,
                }
              : next,
          ),
        setError,
      )
      .finally(() => setLoadingMore(false));
  };
  if (!wa) {
    if (!checked) return null;
    return (
      <Empty>
        {t("orders.onlyTelegram")}{" "}
        <Link to="/s/$slug" params={{ slug }} className="text-accent hover:underline">
          {t("cart.toCatalog")}
        </Link>
      </Empty>
    );
  }
  return (
    <div className="mx-auto max-w-xl space-y-6">
      <h1 className="text-xl font-semibold">
        {t(view === "library" ? "orders.library" : "orders.title")}
      </h1>
      <ErrorBox error={error} />
      {showOrders && data && data.orders.length === 0 && <Empty>{t("orders.empty")}</Empty>}
      {showOrders && data && data.orders.length > 0 && (
        <ul className="divide-y divide-line rounded-md border border-line">
          {data.orders.map((o) => (
            <li key={o.id} className="px-3 py-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="font-medium">#{o.no}</span>
                <span className="tabular-nums">{formatMoney(o.total, o.currency)}</span>
              </div>
              <div className="text-xs text-muted">
                {new Date(o.createdAt).toLocaleDateString(intlLocale(locale))} ·{" "}
                {t(`orders.status.${o.status}` as never) || o.status}
              </div>
              <div className="text-xs text-muted">
                {o.items.map((i) => `${i.name} × ${i.qty}`).join(", ")}
              </div>
            </li>
          ))}
        </ul>
      )}
      {view === "library" && data && data.library.length === 0 && (
        <Empty>{t("orders.libraryEmpty")}</Empty>
      )}
      {showLibrary && data && data.library.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-muted">{t("orders.library")}</h2>
          <p className="mb-2 text-xs text-muted">{t("orders.libraryHint")}</p>
          <ul className="divide-y divide-line rounded-md border border-line">
            {data.library.map((f, i) => (
              <li key={i} className="flex items-center gap-3 px-3 py-2 text-sm">
                {f.cover ? (
                  <img
                    src={f.cover}
                    alt=""
                    loading="lazy"
                    className="h-10 w-10 shrink-0 rounded object-cover"
                  />
                ) : (
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-line/40">
                    📁
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <a
                    href={f.url}
                    target="_blank"
                    rel="noreferrer"
                    className="block truncate text-accent hover:underline"
                  >
                    {f.name}
                  </a>
                  <span className="block truncate text-xs text-muted">
                    {f.item !== f.name ? `${f.item} · ` : ""}
                    {manyLangs ? `${f.lang.toUpperCase()} · ` : ""}#{f.orderNo}
                  </span>
                </div>
              </li>
            ))}
          </ul>
          {data.libraryNext != null && (
            <button className="btn-secondary mt-3 w-full" disabled={loadingMore} onClick={loadMore}>
              {t("orders.libraryMore")}
            </button>
          )}
        </section>
      )}
    </div>
  );
}
