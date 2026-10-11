import { HelpTip } from "@/app/admin/help-panel";
import { getRouteApi } from "@tanstack/react-router";
import { useState } from "react";
import { explainSalesFn } from "@/app/admin/analytics.functions";
import { adminT } from "@/app/i18n/admin";
import { Card, ErrorBox, useAction } from "@/app/ui";
import { DataTable } from "@/app/ui/charts";
import { autoShare, type SpeedRow } from "@/core/analytics/speed";
import { platformLabel } from "./parts";
import { duration } from "./sales-cards";

/** Контекст страницы аналитики: компонент вынесен из файла маршрута. */
const Route = getRouteApi("/admin/_authed/analytics");

/** Скорость ответа и пояснения к цифрам. */

/** Скорость заказа: оплата и выдача по каналам, доля выданных без продавца (core/analytics/speed). */
export function SpeedCard({ rows }: { rows: SpeedRow[] }) {
  const { shop } = Route.useRouteContext();
  const t = adminT(shop.locale);
  const all = rows[0]!;
  const share = autoShare(all);
  return (
    <Card
      title={t("analytics.speed.title")}
      help={<HelpTip article="analytics" anchor="speed" />}
      className="lg:col-span-2"
    >
      {all.placed === 0 ? (
        <p className="text-sm text-muted">{t("analytics.speed.empty")}</p>
      ) : (
        <>
          <p className="mb-3 text-sm">
            {share === null
              ? t("analytics.speed.autoNone")
              : t("analytics.speed.auto", { pct: share, auto: all.auto, delivered: all.delivered })}
          </p>
          <div className="overflow-x-auto">
            <DataTable
              head={[
                t("analytics.col.channel"),
                t("analytics.speed.col.placed"),
                t("analytics.speed.col.payMedian"),
                t("analytics.speed.col.payP90"),
                t("analytics.speed.col.deliverMedian"),
                t("analytics.speed.col.deliverP90"),
                t("analytics.speed.col.auto"),
              ]}
              rows={rows.map((r) => [
                r.channel === "all" ? t("analytics.funnel.all") : platformLabel(r.channel, t),
                r.placed,
                duration(r.pay.median, t),
                duration(r.pay.p90, t),
                duration(r.deliver.median, t),
                duration(r.deliver.p90, t),
                autoShare(r) === null ? "—" : `${autoShare(r)}%`,
              ])}
            />
          </div>
        </>
      )}
      <p className="mt-2 text-xs text-muted">{t("analytics.speed.hint")}</p>
    </Card>
  );
}

/** ИИ-разбор: «Почему изменились продажи». Тратит ИИ-баланс клиента, текст нигде не сохраняется. */
export function ExplainCard({ days }: { days: 7 | 30 | 90 }) {
  const { shop } = Route.useRouteContext();
  const t = adminT(shop.locale);
  const [text, setText] = useState("");
  const explain = useAction(async () => {
    const r = await explainSalesFn({ data: { days, lang: shop.locale } });
    setText(r.text);
  });
  return (
    <Card
      title={t("analytics.explain.title")}
      help={<HelpTip article="analytics" anchor="explain" />}
      className="lg:col-span-2"
    >
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="btn-secondary text-sm"
          disabled={explain.busy}
          onClick={() => void explain.run().catch(() => {})}
        >
          {explain.busy ? t("analytics.explain.busy") : t("analytics.explain.button")}
        </button>
        <p className="text-xs text-muted">{t("analytics.explain.hint", { n: days })}</p>
      </div>
      <ErrorBox error={explain.error} />
      {text && <p className="mt-3 whitespace-pre-line text-sm">{text}</p>}
    </Card>
  );
}
