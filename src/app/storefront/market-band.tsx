import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { answerLabel, type Trust } from "@/core/marketplace/trust";
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
  trust: Trust | null;
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
        <TrustLine trust={props.trust} />
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

/** Цифры платформы по настоящим заказам: только то, что есть, ничего не придумывается. */
function TrustLine({ trust }: { trust: Trust | null }) {
  const { t, locale } = useStorefrontLocale();
  if (!trust) return null;
  const parts: string[] = [];
  if (trust.delivered > 0)
    parts.push(
      t("trust.delivered", { count: new Intl.NumberFormat(locale).format(trust.delivered) }),
    );
  if (trust.answerHours != null) {
    const a = answerLabel(trust.answerHours);
    parts.push(t(`trust.answer.${a.unit}` as "trust.answer.h", { n: a.n }));
  }
  if (trust.rating != null)
    parts.push(t("trust.rating", { rating: trust.rating.toFixed(1), count: trust.ratingCount }));
  if (parts.length === 0) return null;
  return (
    <p className="mt-1 text-xs" data-testid="market-trust">
      {parts.join(" · ")}
    </p>
  );
}
