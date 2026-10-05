import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { readMarketBack, type MarketBack } from "@/app/market/back";
import { useStorefrontLocale } from "@/app/storefront/locale";

/**
 * Плашка магазина, в который покупатель пришёл с площадки (П2): «Вы смотрите только магазин …»,
 * чем занимается и город, вкладки Витрина, Отзывы, О магазине и «Вернуться ко всем товарам» с тем
 * же фильтром. Показывается только магазину, который виден на площадке, и только если запись о
 * переходе с площадки есть в этом браузере; прямая ссылка на магазин остаётся без плашки.
 */
export function MarketBand(props: {
  slug: string;
  name: string;
  tagline: string | null;
  city: string;
  hasAbout: boolean;
  onMarket: boolean;
}) {
  const { t } = useStorefrontLocale();
  const [back, setBack] = useState<MarketBack | null>(null);
  useEffect(() => {
    setBack(props.onMarket ? readMarketBack(props.slug) : null);
  }, [props.slug, props.onMarket]);
  if (!back) return null;
  const tab = "rounded-full px-3 py-1 text-sm";
  return (
    <section className="border-b border-line bg-surface" data-testid="market-band">
      <div className="mx-auto w-full max-w-6xl px-4 py-3">
        <p className="text-sm font-medium">{t("market.only", { shop: props.name })}</p>
        {(props.tagline || props.city) && (
          <p className="mt-0.5 text-xs text-muted">
            {[props.tagline, props.city].filter(Boolean).join(" · ")}
          </p>
        )}
        <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <nav className="flex flex-wrap gap-1" aria-label={props.name}>
            <Link to="/s/$slug" params={{ slug: props.slug }} className={tab}>
              {t("market.tab.shop")}
            </Link>
            {props.hasAbout && (
              <>
                <Link
                  to="/s/$slug/about"
                  params={{ slug: props.slug }}
                  hash="reviews"
                  className={tab}
                >
                  {t("market.tab.reviews")}
                </Link>
                <Link to="/s/$slug/about" params={{ slug: props.slug }} className={tab}>
                  {t("market.tab.about")}
                </Link>
              </>
            )}
          </nav>
          <Link
            to={back.to}
            search={back.search as never}
            className="text-sm font-medium underline"
          >
            {back.to === "/market/search" ? t("market.backItems") : t("market.backAuthors")}
          </Link>
        </div>
      </div>
    </section>
  );
}
