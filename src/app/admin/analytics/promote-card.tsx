import { Link, getRouteApi } from "@tanstack/react-router";
import { analyticsFn } from "@/app/admin/sales-analytics.functions";
import { adminT } from "@/app/i18n/admin";
import { Card } from "@/app/ui";
import { PROMOTE } from "@/core/analytics/promote";

/** Контекст страницы аналитики: компонент вынесен из файла маршрута. */
const Route = getRouteApi("/admin/_authed/analytics");

/** Что продвигать. */

/** «Что продвигать» (У4): хорошо оценённые товары, которые редко берут, и товары, которые скоро закончатся. */
export function PromoteCard({
  hints,
}: {
  hints: NonNullable<Awaited<ReturnType<typeof analyticsFn>>["promote"]>;
}) {
  const { shop } = Route.useRouteContext();
  const t = adminT(shop.locale);
  const days = PROMOTE.windowDays;
  const link = (id: string, name: string) => (
    <Link to="/admin/products/$id" params={{ id }} className="font-medium hover:underline">
      {name}
    </Link>
  );
  return (
    <Card title={t("growth.promote.title")} className="lg:col-span-2">
      {hints === "failed" ? (
        <p className="text-sm text-danger">{t("growth.promote.failed")}</p>
      ) : hints.quality.length === 0 && hints.stock.length === 0 ? (
        <p className="text-sm text-muted">{t("growth.promote.empty")}</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
          {hints.quality.length > 0 && (
            <div>
              <h3 className="mb-2 text-sm font-medium">{t("growth.promote.quality")}</h3>
              <ul className="space-y-2 text-sm">
                {hints.quality.map((h) => (
                  <li key={h.id}>
                    {link(h.id, h.name)}
                    <span className="block text-muted">
                      {t("growth.promote.qualityItem", {
                        avg: h.avg,
                        count: h.count,
                        days,
                        sold: h.sold,
                      })}
                    </span>
                  </li>
                ))}
              </ul>
              {hints.total.quality > hints.quality.length && (
                <p className="mt-2 text-xs text-muted">
                  {t("growth.promote.more", {
                    shown: hints.quality.length,
                    total: hints.total.quality,
                  })}
                </p>
              )}
            </div>
          )}
          {hints.stock.length > 0 && (
            <div>
              <h3 className="mb-2 text-sm font-medium">{t("growth.promote.stock")}</h3>
              <ul className="space-y-2 text-sm">
                {hints.stock.map((h) => (
                  <li key={h.id}>
                    {link(h.id, h.name)}
                    <span className="block text-muted">
                      {h.stock === 0
                        ? t("growth.promote.stockOut", { days, sold: h.sold })
                        : t("growth.promote.stockItem", {
                            stock: h.stock,
                            days,
                            sold: h.sold,
                            left: h.daysLeft,
                          })}
                    </span>
                  </li>
                ))}
              </ul>
              {hints.total.stock > hints.stock.length && (
                <p className="mt-2 text-xs text-muted">
                  {t("growth.promote.more", {
                    shown: hints.stock.length,
                    total: hints.total.stock,
                  })}
                </p>
              )}
            </div>
          )}
        </div>
      )}
      <p className="mt-3 text-xs text-muted">{t("growth.promote.hint")}</p>
    </Card>
  );
}
