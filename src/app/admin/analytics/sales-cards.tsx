import { getRouteApi } from "@tanstack/react-router";
import { analyticsFn } from "@/app/admin/sales-analytics.functions";
import { adminT, intlLocale, type AdminT } from "@/app/i18n/admin";
import { Badge, Card } from "@/app/ui";
import { DataTable } from "@/app/ui/charts";

/** Контекст страницы аналитики: компонент вынесен из файла маршрута. */
const Route = getRouteApi("/admin/_authed/analytics");

/** Продажи и наборы. */

/** Минуты → «5 мин», «2 ч 10 мин», «1 дн 3 ч». */
export function duration(min: number | null, t: AdminT): string {
  if (min === null) return "—";
  const m = Math.round(min);
  if (m < 60) return t("analytics.speed.fmt.m", { n: m });
  if (m < 1440) {
    const h = Math.floor(m / 60);
    const rest = m % 60;
    return [
      t("analytics.speed.fmt.h", { n: h }),
      rest ? t("analytics.speed.fmt.m", { n: rest }) : "",
    ]
      .filter(Boolean)
      .join(" ");
  }
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  return [t("analytics.speed.fmt.d", { n: d }), h ? t("analytics.speed.fmt.h", { n: h }) : ""]
    .filter(Boolean)
    .join(" ");
}

/** Итоги акций: продажи товаров акции за её срок и за такой же срок до неё (core/analytics/sales). */
export function SalesCard({
  sales,
  tz,
  moneyAll,
}: {
  sales: Awaited<ReturnType<typeof analyticsFn>>["sales"];
  tz: string;
  moneyAll: (revenue: Record<string, number>) => string;
}) {
  const { shop } = Route.useRouteContext();
  const t = adminT(shop.locale);
  const loc = intlLocale(shop.locale);
  const date = (iso: string) =>
    new Date(iso).toLocaleDateString(loc, {
      day: "numeric",
      month: "short",
      timeZone: tz,
    });
  const verdict = { up: "ok", flat: undefined, down: "warn", none: undefined } as const;
  return (
    <Card title={t("analytics.sales.title")} className="lg:col-span-2">
      <div className="overflow-x-auto">
        <DataTable
          head={[
            t("analytics.sales.col.offer"),
            t("analytics.sales.col.period"),
            t("analytics.sales.col.orders"),
            t("analytics.sales.col.units"),
            t("analytics.sales.col.revenue"),
            t("analytics.sales.col.verdict"),
          ]}
          rows={sales.map((r) => [
            `${r.name} (−${r.percent}%)`,
            `${date(r.startsAt)} — ${date(r.endsAt)}${r.running ? ` · ${t("analytics.sales.running")}` : ""}`,
            `${r.before.orders} → ${r.during.orders}`,
            `${r.before.units} → ${r.during.units}`,
            `${moneyAll(r.before.revenue) || "0"} → ${moneyAll(r.during.revenue) || "0"}`,
            <Badge key="v" tone={verdict[r.verdict]}>
              {t(`analytics.sales.verdict.${r.verdict}`)}
            </Badge>,
          ])}
        />
      </div>
      <p className="mt-2 text-xs text-muted">{t("analytics.sales.hint")}</p>
    </Card>
  );
}

/** Наборы и подарки: продажи наборов, доля подарочных заказов, выручка упаковки (core/analytics/bundles). */
export function BundlesCard({
  r,
  moneyAll,
}: {
  r: NonNullable<Awaited<ReturnType<typeof analyticsFn>>["giftsBundles"]>;
  moneyAll: (revenue: Record<string, number>) => string;
}) {
  const { shop } = Route.useRouteContext();
  const t = adminT(shop.locale);
  const share = r.gifts.orders > 0 ? Math.round((r.gifts.gifts / r.gifts.orders) * 100) : 0;
  return (
    <Card title={t("analytics.bundles.title")} className="lg:col-span-2">
      <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[max-content_1fr]">
        <dt className="text-muted">{t("analytics.bundles.sold")}</dt>
        <dd data-testid="bundles-sold">
          {t("analytics.bundles.soldValue", { units: r.bundles.units, orders: r.bundles.orders })}
        </dd>
        <dt className="text-muted">{t("analytics.bundles.revenue")}</dt>
        <dd data-testid="bundles-revenue">{moneyAll(r.bundles.revenue) || "0"}</dd>
        <dt className="text-muted">{t("analytics.bundles.saved")}</dt>
        <dd data-testid="bundles-saved">{moneyAll(r.bundles.saving) || "0"}</dd>
        <dt className="text-muted">{t("analytics.bundles.gifts")}</dt>
        <dd data-testid="bundles-gifts">
          {t("analytics.bundles.giftsValue", {
            gifts: r.gifts.gifts,
            orders: r.gifts.orders,
            share,
          })}
        </dd>
        <dt className="text-muted">{t("analytics.bundles.wrap")}</dt>
        <dd data-testid="bundles-wrap">
          {t("analytics.bundles.wrapValue", {
            sum: moneyAll(r.gifts.wrapRevenue) || "0",
            orders: r.gifts.wrapOrders,
          })}
        </dd>
      </dl>
      {r.bundles.rows.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <DataTable
            head={[
              t("analytics.bundles.col.name"),
              t("analytics.bundles.col.units"),
              t("analytics.bundles.col.revenue"),
              t("analytics.bundles.col.saved"),
            ]}
            rows={r.bundles.rows
              .slice(0, 10)
              .map((b) => [b.name, String(b.units), moneyAll(b.revenue), moneyAll(b.saving)])}
          />
        </div>
      )}
      <p className="mt-2 text-xs text-muted">{t("analytics.bundles.hint")}</p>
    </Card>
  );
}
