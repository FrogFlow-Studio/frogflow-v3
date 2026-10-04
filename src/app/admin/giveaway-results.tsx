import { useState } from "react";
import { giveawayResultsFn } from "@/app/admin/giveaways.functions";
import type { AdminT } from "@/app/i18n/admin";
import { ErrorBox, useAction } from "@/app/ui";
import { formatMoney } from "@/core/money/money";

type Results = Awaited<ReturnType<typeof giveawayResultsFn>>;

/** Итоги розыгрыша под карточкой: загружаются по кнопке, ничего не пишут. */
export function GiveawayResults({ id, t, locale }: { id: string; t: AdminT; locale: string }) {
  const [res, setRes] = useState<Results | null>(null);
  const load = useAction(async () => setRes(await giveawayResultsFn({ data: { id } })));
  const money = Object.entries(res?.revenue ?? {});
  return (
    <div className="mt-2" data-testid={`giveaway-results-${id}`}>
      {!res && (
        <button
          type="button"
          className="btn-ghost text-xs"
          disabled={load.busy}
          onClick={() => void load.run().catch(() => {})}
        >
          {t("giveaways.results.show")}
        </button>
      )}
      <ErrorBox error={load.error} />
      {res && (
        <ul className="space-y-0.5 text-xs">
          <li>{t("giveaways.results.participants", { n: res.participants })}</li>
          {res.eligible !== null && <li>{t("giveaways.results.eligible", { n: res.eligible })}</li>}
          <li>{t("giveaways.results.newBuyers", { n: res.newBuyers })}</li>
          {res.subscribed !== null && (
            <li>{t("giveaways.results.subscribed", { n: res.subscribed })}</li>
          )}
          <li>
            {t("giveaways.results.orders", {
              buyers: res.buyers,
              orders: res.orders,
              days: res.window.days,
            })}
          </li>
          <li>
            {money.length
              ? t("giveaways.results.revenue", {
                  sum: money.map(([cur, v]) => formatMoney(v.revenue, cur)).join(" · "),
                })
              : t("giveaways.results.noRevenue")}
          </li>
          {!res.window.closed && (
            <li className="text-muted">
              {t("giveaways.results.windowOpen", {
                date: new Date(res.window.to).toLocaleDateString(locale),
              })}
            </li>
          )}
          <li className="text-muted">{t("giveaways.results.note")}</li>
        </ul>
      )}
    </div>
  );
}
