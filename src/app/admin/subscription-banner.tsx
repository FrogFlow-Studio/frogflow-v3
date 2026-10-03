import { Link } from "@tanstack/react-router";
import { adminT, intlLocale, type AdminT } from "@/app/i18n/admin";
import type { Locale } from "@/core/i18n/locale";
import type { SellerSubscription } from "@/core/billing/seller-status";

const fmt = (iso: string, locale: Locale, year: boolean) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString(intlLocale(locale), {
    day: "2-digit",
    month: "2-digit",
    ...(year ? { year: "numeric" } : {}),
    timeZone: "UTC",
  });

/** Срок подписки словами — для плашки над админкой и для «Ваш план». */
export function subscriptionLine(
  t: AdminT,
  locale: Locale,
  s: SellerSubscription,
  year = false,
): string {
  const date = fmt(s.paidUntil, locale, year);
  const n = Math.abs(s.daysLeft);
  if (s.state === "ok") return t("sub.paid", { date });
  if (s.state === "expiring")
    return s.daysLeft === 0 ? t("sub.lastDay", { date }) : t("sub.left", { date, n });
  if (s.suspended) return t("sub.suspended", { n });
  if (s.mode === "warn") return t("sub.overdue.warn", { n });
  if (s.state === "grace_over" || !s.stopOn) return t("sub.stopSoon", { n });
  return t("sub.overdue.suspend", { n, stop: fmt(s.stopOn, locale, false) });
}

/** Плашка над админкой: подписка кончается или просрочена. У пробного периода своя (TrialBanner). */
export function SubscriptionBanner({
  locale,
  sub,
  owner,
}: {
  locale: Locale;
  sub: SellerSubscription;
  owner: boolean;
}) {
  const t = adminT(locale);
  const bad = sub.state !== "expiring";
  return (
    <div
      className={`mb-4 flex flex-wrap items-center gap-3 rounded-md border p-3 text-sm ${bad ? "border-red-500" : "border-line"}`}
    >
      <span className="min-w-0 flex-1">
        <strong>{subscriptionLine(t, locale, sub)}</strong>
      </span>
      {owner && (
        <Link to="/admin/modules" className="btn-primary text-sm">
          {t("plan.pay")}
        </Link>
      )}
    </div>
  );
}
