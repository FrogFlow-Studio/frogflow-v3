import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { storeFavoritesFn } from "@/app/storefront/catalog.functions";
import { useStorefrontLocale } from "@/app/storefront/locale";
import { formatMoney } from "@/core/money/money";
import type { StoreProduct } from "@/core/storefront/catalog";
import { orderRecent, parseRecent, pushRecent } from "@/core/storefront/recent";

/** «Недавно смотрели»: список лежит в браузере по магазину (core/storefront/recent), сервер его не хранит. */
const key = (slug: string) => `ff-recent-${slug}`;

function readRecent(slug: string): string[] {
  try {
    return parseRecent(localStorage.getItem(key(slug)));
  } catch {
    return [];
  }
}

/** Запомнить открытый товар: он встаёт первым. */
export function useRememberViewed(slug: string, productId: string) {
  useEffect(() => {
    try {
      localStorage.setItem(key(slug), JSON.stringify(pushRecent(readRecent(slug), productId)));
    } catch {
      /* приватный режим */
    }
  }, [slug, productId]);
}

/** Строка «Недавно смотрели»; пустой список или сбой чтения — ничего не рисуем. `exclude` — открытый сейчас товар. */
export function RecentlyViewed({ slug, exclude }: { slug: string; exclude?: string }) {
  const { t } = useStorefrontLocale();
  const [items, setItems] = useState<StoreProduct[]>([]);
  useEffect(() => {
    const ids = readRecent(slug).filter((id) => id !== exclude);
    if (ids.length === 0) return void setItems([]);
    let live = true;
    storeFavoritesFn({ data: { slug, ids } }).then(
      (r) => live && setItems(orderRecent(ids, r)),
      () => {
        /* блок необязательный: при сбое просто не показываем */
      },
    );
    return () => {
      live = false;
    };
  }, [slug, exclude]);
  if (items.length === 0) return null;
  return (
    <section className="mt-10" aria-label={t("recent.title")}>
      <h2 className="mb-3 text-lg font-semibold">{t("recent.title")}</h2>
      <div className="flex gap-3 overflow-x-auto pb-2">
        {items.map((p) => (
          <Link
            key={p.id}
            to="/s/$slug/p/$id"
            params={{ slug, id: p.id }}
            className="card w-32 shrink-0 overflow-hidden sm:w-40"
          >
            {p.images[0] ? (
              <img
                src={p.images[0]}
                alt=""
                className="aspect-square w-full object-cover"
                loading="lazy"
              />
            ) : (
              <div className="aspect-square bg-surface-2" />
            )}
            <div className="p-2 text-xs">
              <div className="line-clamp-2">{p.name}</div>
              <div className="mt-1 font-semibold">{formatMoney(p.price, p.currency)}</div>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
