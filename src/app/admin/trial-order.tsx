import { useState } from "react";
import { trialOrderFn } from "@/app/admin/onboarding.functions";
import type { AdminKey, AdminT } from "@/app/i18n/admin";
import { ErrorBox, useAction } from "@/app/ui";
import type { TrialResult } from "@/core/orders/trial";
import { formatMoney } from "@/core/money/money";

/**
 * Кнопка «Пробный заказ» (Р4): проверка оформления без заказа в базе. Показывает,
 * прошла ли проверка, сумму и что именно мешает покупке.
 */
export function TrialOrder({ t }: { t: AdminT }) {
  const [res, setRes] = useState<TrialResult | null>(null);
  const run = useAction(async () => {
    setRes(null);
    setRes(await trialOrderFn({ data: { productId: null } }));
  });
  return (
    <div className="my-2 text-sm" data-testid="trial-order">
      <p className="mb-2 text-muted">{t("trial.intro")}</p>
      <button
        type="button"
        className="btn-secondary"
        disabled={run.busy}
        onClick={() => void run.run().catch(() => {})}
      >
        {run.busy ? t("trial.running") : t("trial.button")}
      </button>
      <ErrorBox error={run.error} />
      {res && (
        <div className="mt-2 space-y-1" role="status">
          {res.noProduct ? (
            <p>{t("trial.noProduct")}</p>
          ) : (
            <>
              <p className={res.ok ? "font-medium" : "font-medium text-danger"}>
                {res.ok ? t("trial.passed", { name: res.product?.name ?? "" }) : t("trial.failed")}
              </p>
              <p className="text-muted">
                {t("trial.sum", {
                  total: formatMoney(res.total, res.currency),
                  due: formatMoney(res.dueNow, res.currency),
                })}
              </p>
              {res.issues.length > 0 && (
                <ul className="list-disc pl-5">
                  {res.issues.map((i) => (
                    <li key={i}>{t(`trial.issue.${i}` as AdminKey)}</li>
                  ))}
                </ul>
              )}
              <p className="text-xs text-muted">
                {t(`trial.notified.${res.notified}` as AdminKey)}
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
