import { Link } from "@tanstack/react-router";
import { TrialOrder } from "@/app/admin/trial-order";
import type { AdminKey, AdminT } from "@/app/i18n/admin";
import { Card } from "@/app/ui";
import type { FirstWeekState, FirstWeekStep } from "@/core/launch/first-week";

/**
 * «Первые 7 дней» (Р3): четыре шага до первой продажи. Состояние приходит с
 * сервера и считается по данным (core/launch/first-week): кнопок «отметить
 * сделанным» здесь нет.
 */
export function FirstWeekCard({ state, t }: { state: FirstWeekState; t: AdminT }) {
  const action = (step: FirstWeekStep) => {
    switch (step) {
      case "product":
        return (
          <Link to="/admin/products/$id" params={{ id: "new" }} className="btn-secondary text-sm">
            {t("week.productAction")}
          </Link>
        );
      case "payment":
        return (
          <Link to="/admin/settings" className="btn-secondary text-sm">
            {t("week.paymentAction")}
          </Link>
        );
      case "link":
        return (
          <Link to="/admin/share" className="btn-secondary text-sm">
            {t("week.linkAction")}
          </Link>
        );
      case "trial":
        return <TrialOrder t={t} />;
    }
  };
  return (
    <Card
      title={`${t("week.title")} · ${t("week.percent", { n: state.percent })}`}
      className="mb-6"
    >
      <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-line" data-testid="week-progress">
        <div className="h-full bg-accent transition-all" style={{ width: `${state.percent}%` }} />
      </div>
      <p className="mb-3 text-sm text-muted">{t("week.intro")}</p>
      <ol className="space-y-3 text-sm" data-testid="first-week">
        {state.rows.map((r) => {
          const current = state.next === r.step;
          return (
            <li key={r.step} className="flex gap-3" data-done={r.done ? "1" : "0"}>
              <span
                className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-xs ${r.done ? "bg-ok text-white" : current ? "border-2 border-accent text-accent" : "border border-line text-muted"}`}
              >
                {r.done ? "✓" : ""}
              </span>
              <div className="min-w-0">
                <span className={r.done ? "font-medium text-muted line-through" : "font-medium"}>
                  {t(`week.${r.step}` as AdminKey)}
                </span>
                {current && <span className="badge ml-2 text-[11px]">{t("week.next")}</span>}
                {!r.done && (
                  <div className="mt-1 space-y-2 text-muted">
                    <p>{t(`week.${r.step}Hint` as AdminKey)}</p>
                    {action(r.step)}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}
