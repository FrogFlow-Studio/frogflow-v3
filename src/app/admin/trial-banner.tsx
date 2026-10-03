import { Link } from "@tanstack/react-router";
import { adminT, intlLocale } from "@/app/i18n/admin";
import type { Locale } from "@/core/i18n/locale";

export type TrialBannerData = {
  until: string;
  daysLeft: number;
  after: { mode: "warn" | "suspend"; graceDays: number };
};

/** Пробный период на виду: до какого дня, сколько осталось и что будет после (то же, что пишет напоминание). */
export function TrialBanner({
  locale,
  trial,
  owner,
}: {
  locale: Locale;
  trial: TrialBannerData;
  owner: boolean;
}) {
  const t = adminT(locale);
  const date = new Date(`${trial.until}T12:00:00Z`).toLocaleDateString(intlLocale(locale), {
    day: "2-digit",
    month: "2-digit",
    timeZone: "UTC",
  });
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-md border border-line p-3 text-sm">
      <span className="min-w-0 flex-1">
        <strong>
          {trial.daysLeft === 0
            ? t("trial.bannerLast", { date })
            : t("trial.banner", { date, n: trial.daysLeft })}
        </strong>{" "}
        {trial.after.mode === "suspend"
          ? t("trial.after.suspend", { grace: trial.after.graceDays })
          : t("trial.after.warn")}
      </span>
      {owner && (
        <Link to="/admin/modules" className="btn-secondary text-sm">
          {t("trial.choose")}
        </Link>
      )}
    </div>
  );
}
