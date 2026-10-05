import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { rememberMarketBack } from "@/app/market/back";
import { marketRecentFn } from "@/app/market/feeds.functions";
import { marketT } from "@/app/market/i18n";
import type { Locale } from "@/core/i18n/locale";
import type { MarketItem } from "@/core/marketplace/items";
import { MARKET_RECENT_KEY, parseViews } from "@/core/marketplace/views";

/** Лента карточек: на телефоне в один столбец, дальше в два; без горизонтальной прокрутки. */
function FeedList({
  title,
  items,
  locale,
  testId,
}: {
  title: string;
  items: MarketItem[];
  locale: Locale;
  testId: string;
}) {
  if (items.length === 0) return null;
  return (
    <section className="mt-8" data-testid={testId}>
      <h2 className="text-lg font-semibold">{title}</h2>
      <ul className="mt-3 grid gap-3 sm:grid-cols-2">
        {items.map((i) => (
          <li key={`${i.shopId}:${i.id}`} className="card flex min-w-0 gap-3 p-4">
            {i.image && (
              <img
                src={i.image}
                alt=""
                loading="lazy"
                className="h-16 w-16 shrink-0 rounded object-cover"
              />
            )}
            <div className="min-w-0">
              <Link
                to="/s/$slug/p/$id"
                params={{ slug: i.shopSlug, id: i.id }}
                className="font-medium underline-offset-2 hover:underline"
                onClick={() => rememberMarketBack(i.shopSlug, "/market/search", {})}
              >
                {i.name}
              </Link>
              <p className="text-sm">
                {new Intl.NumberFormat(locale).format(i.price)} {i.currency}
              </p>
              <p className="mt-0.5 truncate text-xs text-muted">{i.shopName}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** «Новинки», «Часто покупают» и «Недавно смотрели» (последняя только из браузера, Л2). */
export function MarketFeeds({
  fresh,
  popular,
  locale,
}: {
  fresh: MarketItem[];
  popular: MarketItem[];
  locale: Locale;
}) {
  const t = marketT(locale);
  const [recent, setRecent] = useState<MarketItem[]>([]);
  useEffect(() => {
    let live = true;
    let views: ReturnType<typeof parseViews> = [];
    try {
      views = parseViews(localStorage.getItem(MARKET_RECENT_KEY));
    } catch {
      /* приватный режим: просто без этого блока */
    }
    if (views.length === 0) return;
    marketRecentFn({ data: { views } }).then(
      (r) => live && setRecent(r),
      () => {
        /* блок необязательный: при сбое не показываем */
      },
    );
    return () => {
      live = false;
    };
  }, []);
  return (
    <>
      <FeedList title={t("feed.recent")} items={recent} locale={locale} testId="feed-recent" />
      <FeedList title={t("feed.fresh")} items={fresh} locale={locale} testId="feed-fresh" />
      <FeedList title={t("feed.popular")} items={popular} locale={locale} testId="feed-popular" />
    </>
  );
}
