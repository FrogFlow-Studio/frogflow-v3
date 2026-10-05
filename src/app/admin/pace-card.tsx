import type { AdminT } from "@/app/i18n/admin";
import { Card, Empty } from "@/app/ui";
import { formatMoney } from "@/core/money/money";
import type { SalesPace } from "@/core/overview/pace";

/** «Продажи сегодня» (Ж3): сумма, сравнение со вчерашним днём к этому же времени, продажи по часам. */
export function PaceCard({ pace, t }: { pace: SalesPace | "failed"; t: AdminT }) {
  if (pace === "failed")
    return (
      <Card title={t("pace.title")} className="mb-6">
        <p className="text-sm text-danger">{t("waiting.failed")}</p>
      </Card>
    );
  const max = Math.max(1, ...pace.byHour);
  const compare =
    pace.deltaPct === null
      ? t("pace.noBase")
      : pace.deltaPct === 0
        ? t("pace.same")
        : t(pace.deltaPct > 0 ? "pace.up" : "pace.down", { n: Math.abs(pace.deltaPct) });
  return (
    <Card title={t("pace.title")} className="mb-6">
      {pace.orders === 0 && pace.yesterdaySoFar === 0 ? (
        <Empty>{t("pace.none")}</Empty>
      ) : (
        <>
          <div className="text-2xl font-semibold tabular-nums">
            {formatMoney(pace.today, pace.currency)}
          </div>
          <p className="mt-1 text-sm text-muted">{compare}</p>
          <p className="text-xs text-muted">
            {t("pace.yesterday", { sum: formatMoney(pace.yesterdaySoFar, pace.currency) })}
          </p>
          <div
            role="img"
            aria-label={t("pace.byHour")}
            className="mt-3 flex h-16 items-end gap-0.5"
            data-pace-hours
          >
            {pace.byHour.map((v, h) => (
              <div
                key={h}
                title={`${String(h).padStart(2, "0")}:00 · ${formatMoney(v, pace.currency)}`}
                className="min-w-0 flex-1 rounded-sm bg-accent/70"
                style={{ height: `${v > 0 ? Math.max(6, Math.round((v / max) * 100)) : 2}%` }}
              />
            ))}
          </div>
        </>
      )}
    </Card>
  );
}
