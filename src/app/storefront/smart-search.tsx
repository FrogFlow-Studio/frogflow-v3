import { useEffect, useState } from "react";
import { usePhotoFrame } from "@/app/storefront/photo-frame";
import { Link } from "@tanstack/react-router";
import { storeSmartSearchFn } from "./smart-search.functions";
import { useStorefrontLocale } from "./locale";
import { OfferPrice } from "./offer";
import { formatRatingSummary } from "@/core/reviews/pure";
import type { StoreProduct } from "@/core/storefront/catalog";

/** Сессия браузера для кулдауна умного поиска: живёт, пока открыта вкладка. */
function searchSession(slug: string): string {
  const key = `ff-sid-${slug}`;
  const fresh = () =>
    (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`).replace(
      /[^A-Za-z0-9-]/g,
      "",
    );
  try {
    const have = sessionStorage.getItem(key);
    if (have && /^[A-Za-z0-9-]{8,64}$/.test(have)) return have;
    const id = fresh();
    sessionStorage.setItem(key, id);
    return id;
  } catch {
    return fresh();
  }
}

/**
 * «Ничего не нашлось» на витрине → умный поиск по смыслу (тот же, что в боте), если
 * продавец его включил. Выключен — блок ничего не рисует и обычная пустая страница остаётся.
 */
export function SmartSearchResults({ slug, q }: { slug: string; q: string }) {
  const { t } = useStorefrontLocale();
  const frame = usePhotoFrame();
  const [state, setState] = useState<"loading" | "ok" | "busy" | "none">("loading");
  const [items, setItems] = useState<StoreProduct[]>([]);
  useEffect(() => {
    let live = true;
    setState("loading");
    storeSmartSearchFn({ data: { slug, q, session: searchSession(slug) } })
      .then((r) => {
        if (!live) return;
        setItems(r.items);
        setState(r.state === "off" ? "none" : r.state);
      })
      .catch(() => live && setState("none"));
    return () => {
      live = false;
    };
  }, [slug, q]);
  if (state === "none") return null;
  if (state === "loading")
    return <p className="mt-4 text-center text-sm text-muted">{t("catalog.smartSearching")}</p>;
  if (state === "busy")
    return <p className="mt-4 text-center text-sm text-muted">{t("catalog.smartBusy")}</p>;
  return (
    <section className="mt-6" aria-label={t("catalog.smartFound")}>
      <h2 className="mb-3 text-sm font-semibold text-muted">{t("catalog.smartFound")}</h2>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {items.map((p) => (
          <article key={p.id} className="card flex flex-col overflow-hidden">
            <Link to="/s/$slug/p/$id" params={{ slug, id: p.id }} search={{ q }} className="block">
              {p.images[0] ? (
                <img src={p.images[0]} alt={p.name} className={frame.img} loading="lazy" />
              ) : (
                <div
                  className={`flex ${frame.box} items-center justify-center bg-surface-2 text-4xl`}
                >
                  {p.kind === "digital" ? "📄" : "📦"}
                </div>
              )}
            </Link>
            <div className="flex flex-1 flex-col gap-1 p-3">
              <Link
                to="/s/$slug/p/$id"
                params={{ slug, id: p.id }}
                search={{ q }}
                className="line-clamp-2 text-sm font-medium hover:underline"
              >
                {p.name}
              </Link>
              {p.rating && (
                <span className="text-xs text-muted">
                  {formatRatingSummary(p.rating.avg, p.rating.count)}
                </span>
              )}
              <span className="mt-auto text-sm font-semibold">
                <OfferPrice
                  price={p.price}
                  oldPrice={p.offer?.oldPrice ?? null}
                  currency={p.currency}
                  offer={p.offer}
                  label={(price) => (p.priceFrom ? t("catalog.priceFrom", { price }) : price)}
                />
              </span>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
