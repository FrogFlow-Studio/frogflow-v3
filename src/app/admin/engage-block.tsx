import type { AdminT } from "@/app/i18n/admin";
import type { EngageStats } from "@/core/automsg/engage";

/** Итоги подбора и «С этим берут» за 30 дней: сколько прошли квиз и сколько добавили товар. */
export function EngageBlock({
  t,
  stats,
  quiz,
  upsell,
}: {
  t: AdminT;
  stats: EngageStats | undefined;
  quiz: boolean;
  upsell: boolean;
}) {
  if (!stats) return null;
  return (
    <div className="rounded-lg border border-line p-2 text-xs" data-testid="engage-stats">
      <p className="font-medium">{t("autostats.title")}</p>
      {quiz && (
        <p className="mt-1 tabular-nums">
          {t("engage.quiz", { n: stats.quizDone, buyers: stats.quizBuyers })}
        </p>
      )}
      {upsell && (
        <p className="tabular-nums">
          {t("engage.upsell", { n: stats.upsellAdded, buyers: stats.upsellBuyers })}
        </p>
      )}
      <p className="mt-1 text-muted">{t("engage.hint")}</p>
    </div>
  );
}
