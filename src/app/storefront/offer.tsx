import type { StoreProduct } from "@/core/storefront/catalog";
import { formatMoney } from "@/core/money/money";
import { intlLocale } from "@/app/i18n/admin";
import { useStorefrontLocale } from "./locale";

type Offer = NonNullable<StoreProduct["offer"]>;

/**
 * Цена с акцией: новая, рядом зачёркнутая прежняя и «−N %». Без акции —
 * просто цена (`label` — как её подписать: «от …» у товара с вариантами).
 */
export function OfferPrice({
  price,
  oldPrice,
  currency,
  offer,
  label = (s) => s,
  className = "",
}: {
  price: number;
  oldPrice: number | null;
  currency: string;
  offer: Offer | null;
  label?: (price: string) => string;
  className?: string;
}) {
  const shown = label(formatMoney(price, currency));
  if (!offer || oldPrice == null || oldPrice <= price)
    return <span className={`tabular-nums ${className}`}>{shown}</span>;
  return (
    <span className={`inline-flex flex-wrap items-baseline gap-x-1.5 ${className}`}>
      <span className="tabular-nums text-accent">{shown}</span>
      <s className="text-[0.8em] font-normal text-muted tabular-nums">
        {formatMoney(oldPrice, currency)}
      </s>
      <span className="rounded bg-accent/10 px-1 text-[0.75em] font-semibold text-accent">
        −{offer.percent} %
      </span>
    </span>
  );
}

/** «Акция до 30.09, 23:59 · осталось 5» — в часовом поясе магазина. */
export function OfferNote({ offer, className = "" }: { offer: Offer; className?: string }) {
  const { locale, t } = useStorefrontLocale();
  const until = new Date(offer.endsAt).toLocaleString(intlLocale(locale), {
    timeZone: offer.tz,
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  return (
    <span className={className}>
      {t("offer.until", { date: until })}
      {offer.left != null && <> · {t("offer.left", { n: offer.left })}</>}
    </span>
  );
}
