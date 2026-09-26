import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { miniAppOrdersFn } from "@/app/storefront/storefront.functions";
import { useTelegramWebApp } from "@/app/storefront/cart";
import { useStorefrontLocale } from "@/app/storefront/locale";
import { formatMoney } from "@/core/money/money";
import { Empty, ErrorBox } from "@/app/ui";
import { intlLocale } from "@/app/i18n/admin";

export const Route = createFileRoute("/s/$slug/orders")({ component: OrdersPage });

type Data = Awaited<ReturnType<typeof miniAppOrdersFn>>;

/** Mini App: мои заказы и библиотека выданных материалов — только внутри Telegram. */
function OrdersPage() {
  const { slug } = Route.useParams();
  const { t, locale } = useStorefrontLocale();
  const wa = useTelegramWebApp();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [checked, setChecked] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setChecked(true), 300);
    return () => clearTimeout(timer);
  }, []);
  useEffect(() => {
    if (!wa) return;
    miniAppOrdersFn({ data: { slug, initData: wa.initData } }).then(setData, setError);
  }, [wa, slug]);
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
      <h1 className="text-xl font-semibold">{t("orders.title")}</h1>
      <ErrorBox error={error} />
      {data && data.orders.length === 0 && <Empty>{t("orders.empty")}</Empty>}
      {data && data.orders.length > 0 && (
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
      {data && data.library.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-muted">{t("orders.library")}</h2>
          <p className="mb-2 text-xs text-muted">{t("orders.libraryHint")}</p>
          <ul className="divide-y divide-line rounded-md border border-line">
            {data.library.map((f, i) => (
              <li key={i} className="px-3 py-2 text-sm">
                <a
                  href={f.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-accent hover:underline"
                >
                  📁 {f.name}
                </a>
                <span className="text-xs text-muted"> · #{f.orderNo}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
