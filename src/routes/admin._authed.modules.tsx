import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { myPlanFn, payPlanFn, requestPlanFn } from "@/app/admin/plan.functions";
import { requestModuleFn } from "@/app/admin/settings.functions";
import { subscriptionLine } from "@/app/admin/subscription-banner";
import { moduleOffered } from "@/app/admin/module-offer";
import { adminT, intlLocale, type AdminT } from "@/app/i18n/admin";
import type { Locale } from "@/core/i18n/locale";
import { BILLING_PERIODS, type BillingPeriod } from "@/core/tenant/types";
import { moduleDescKey, moduleGroupKey, moduleTitleKey } from "@/app/i18n/admin/catalog";
import { Badge, Card, ErrorBox, PageTitle, useAction } from "@/app/ui";
import { MODULE_KEYS, moduleDef, type ModuleKey } from "@/core/modules/registry";
import { planModules } from "@/core/plans/plans";
import {
  ADDONS,
  ADDON_MONTHLY_PRICE,
  PLAN_TIERS,
  TIER_TITLES,
  nicheForVertical,
  type AddonKey,
  type PlanNiche,
  type PlanTier,
} from "@/core/plans/registry";

export const Route = createFileRoute("/admin/_authed/modules")({
  loader: () => myPlanFn(),
  component: ModulesPage,
});

type MyPlan = Awaited<ReturnType<typeof myPlanFn>>;
type PlanRequestKey = `plan:${PlanTier}` | `addon:${AddonKey}`;
type PayInvoice = Awaited<ReturnType<typeof payPlanFn>>;

/** Счёт после «Оплатить»: QR и ссылка Kaspi Pay или реквизиты для перевода. */
function PayBox({ inv, t, n }: { inv: PayInvoice; t: AdminT; n: (x: number) => string }) {
  const amount = n(inv.amount);
  return (
    <div className="mt-4 rounded border border-line p-3 text-sm">
      <div className="font-medium">{t("plan.payTitle", { amount })}</div>
      {inv.note && <div className="text-xs text-muted">{inv.note}</div>}
      {inv.payUrl ? (
        <div className="mt-2 flex flex-wrap items-center gap-4">
          {inv.qr && (
            <img
              src={`data:image/svg+xml;utf8,${encodeURIComponent(inv.qr)}`}
              alt="QR Kaspi"
              className="h-40 w-40 bg-white"
            />
          )}
          <div className="max-w-sm space-y-2">
            <a
              className="btn-primary inline-block text-xs"
              href={inv.payUrl}
              target="_blank"
              rel="noreferrer"
            >
              {t("plan.payOpen")}
            </a>
            <p className="text-xs text-muted">{t("plan.payHint", { amount })}</p>
          </div>
        </div>
      ) : (
        <div className="mt-2 space-y-2">
          <p className="text-xs text-muted">{t("plan.payTransfer", { amount })}</p>
          <pre className="whitespace-pre-wrap text-xs">{inv.requisites}</pre>
        </div>
      )}
    </div>
  );
}

/** Нижний уровень ниши, в который входит модуль; null — ни в одном плане. */
function tierOf(niche: PlanNiche, key: ModuleKey): PlanTier | null {
  return PLAN_TIERS.find((t) => planModules(niche, t).has(key)) ?? null;
}

function PlanPanel({
  p,
  t,
  locale,
  shopLocale,
}: {
  p: MyPlan;
  t: AdminT;
  locale: string;
  shopLocale: Locale;
}) {
  const router = useRouter();
  const [sent, setSent] = useState<Set<string>>(new Set(p.pending));
  const req = useAction(async (key: PlanRequestKey) => {
    await requestPlanFn({ data: { key } });
    setSent((s) => new Set(s).add(key));
    await router.invalidate();
  });
  const [invoice, setInvoice] = useState<PayInvoice | null>(null);
  const [payPeriod, setPayPeriod] = useState<BillingPeriod>(p.period);
  const pay = useAction(async () => setInvoice(await payPlanFn({ data: { period: payPeriod } })));
  const n = (x: number) => x.toLocaleString(locale);
  const usageLine = (used: number, limit: number | null | undefined) =>
    limit === null || limit === undefined
      ? t("plan.unlimited", { used: n(used) })
      : limit === 0 && used === 0
        ? t("plan.notIncluded")
        : t("plan.of", { used: n(used), limit: n(limit) });
  const limitValue = (v: number | null) =>
    v === null ? t("plan.noLimit") : v === 0 ? t("plan.none") : n(v);
  if (p.plan === "custom")
    return (
      <Card title={t("plan.title")} className="mb-4">
        <p className="text-sm">{t("plan.custom")}</p>
      </Card>
    );
  if (!p.plan) return null;
  const current = p.plan;
  // В пробном периоде тариф ещё не выбран: предлагаем любой, после оплаты — только выше.
  const higher = p.choosing
    ? PLAN_TIERS.filter((x) => x !== current)
    : PLAN_TIERS.slice(PLAN_TIERS.indexOf(current) + 1);
  const nextTier = PLAN_TIERS[PLAN_TIERS.indexOf(current) + 1];
  const nextLimits = nextTier && p.tierLimits ? p.tierLimits[nextTier] : null;
  const addons = p.availableAddons.filter((a) => !p.addons.includes(a));
  return (
    <Card
      title={t("plan.title")}
      className="mb-4"
      actions={<Badge tone="accent">{TIER_TITLES[current]}</Badge>}
    >
      <div className="grid gap-4 text-sm md:grid-cols-2">
        <div className="space-y-1">
          <div className="text-lg font-semibold">
            {TIER_TITLES[current]} ·{" "}
            {t("plan.perMonth", {
              price: n(p.contractMonthly ?? p.prices.monthly[current]),
            })}
          </div>
          {p.period === "year" && <div className="text-muted">{t("plan.perYear")}</div>}
          {p.period === "quarter" && <div className="text-muted">{t("plan.perQuarter")}</div>}
          {p.trialUntil && (
            <div className="text-muted">
              {t("plan.trial", {
                date: new Date(p.trialUntil).toLocaleDateString(locale),
              })}
            </div>
          )}
          {p.subscription && (
            <div className={p.subscription.state === "ok" ? "text-muted" : "font-medium"}>
              {subscriptionLine(t, shopLocale, p.subscription, true)}
            </div>
          )}
          {p.addons.map((a) => (
            <div key={a}>
              <Badge tone="ok">{t("plan.addon", { channel: ADDONS[a].title })}</Badge>
            </div>
          ))}
        </div>
        <div className="space-y-1">
          <div className="font-medium">{t("plan.usage")}</div>
          <div className="flex justify-between">
            <span className="text-muted">{t("plan.dialogs")}</span>
            <span className="tabular-nums">
              {usageLine(p.usage.aiDialogs, p.usage.limits?.aiDialogs)}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted">{t("plan.receipts")}</span>
            <span className="tabular-nums">
              {usageLine(p.usage.receiptChecks, p.usage.limits?.receiptChecks)}
            </span>
          </div>
          {nextTier && nextLimits && (
            <p className="text-xs text-muted">
              {t("plan.nextLimits", {
                tier: TIER_TITLES[nextTier],
                dialogs: limitValue(nextLimits.aiDialogs),
                receipts: limitValue(nextLimits.receiptChecks),
              })}
            </p>
          )}
          <p className="text-xs text-muted">{t("plan.limitHint")}</p>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-3">
        <Link to="/admin/billing" className="btn-secondary text-xs">
          {t("billing.open")}
        </Link>
        <label className="flex items-center gap-2 text-xs">
          <span className="text-muted">{t("plan.payFor")}</span>
          <select
            className="input py-1 text-xs"
            value={payPeriod}
            onChange={(e) => setPayPeriod(e.target.value as BillingPeriod)}
          >
            {BILLING_PERIODS.map((x) => (
              <option key={x} value={x}>
                {t(`plan.period.${x}`)}
              </option>
            ))}
          </select>
        </label>
        <button
          className="btn-primary text-xs"
          disabled={pay.busy}
          onClick={() => void pay.run().catch(() => {})}
        >
          {t("plan.pay")}
        </button>
      </div>
      <p className="mt-2 text-xs text-muted">{t("plan.freeConnection")}</p>
      {invoice && <PayBox inv={invoice} t={t} n={n} />}
      <ErrorBox error={pay.error} />
      {(higher.length > 0 || addons.length > 0) && (
        <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-3">
          {higher.map((tier) => {
            const key = `plan:${tier}` as const;
            return (
              <button
                key={tier}
                className="btn-primary text-xs"
                title={t("plan.upgradeHint", {
                  price: n(p.prices.monthly[tier]),
                  connection: n(p.prices.connection[tier]),
                })}
                disabled={req.busy || sent.has(key)}
                onClick={() => void req.run(key).catch(() => {})}
              >
                {sent.has(key)
                  ? t("plan.requested")
                  : `${t(
                      PLAN_TIERS.indexOf(tier) > PLAN_TIERS.indexOf(current)
                        ? "plan.upgradeTo"
                        : "plan.chooseTier",
                      { tier: TIER_TITLES[tier] },
                    )} · ${n(p.prices.monthly[tier])} ₸`}
              </button>
            );
          })}
          {addons.map((a: AddonKey) => {
            const key = `addon:${a}` as const;
            return (
              <button
                key={a}
                className="btn-secondary text-xs"
                disabled={req.busy || sent.has(key)}
                onClick={() => void req.run(key).catch(() => {})}
              >
                {sent.has(key)
                  ? t("plan.requested")
                  : `${t("plan.addAddon")}: ${t("plan.addon", { channel: ADDONS[a].title })} · ${t("plan.perMonth", { price: n(ADDON_MONTHLY_PRICE[a]) })}`}
              </button>
            );
          })}
        </div>
      )}
      <ErrorBox error={req.error} />
    </Card>
  );
}

function ModulesPage() {
  const p = Route.useLoaderData();
  const { shop } = Route.useRouteContext();
  const t = adminT(shop.locale);
  const locale = intlLocale(shop.locale);
  const [requested, setRequested] = useState<Set<string>>(new Set());
  const req = useAction(async (key: ModuleKey) => {
    await requestModuleFn({ data: { key } });
    setRequested((s) => new Set(s).add(key));
  });
  const niche = nicheForVertical(shop.vertical);
  // На плане модули по одному не продаются: вместо цены — в каком плане модуль есть.
  const onPlan = p.plan !== null && p.plan !== "custom" && niche !== null;
  const groups = new Map<ReturnType<typeof moduleGroupKey>, ModuleKey[]>();
  for (const k of MODULE_KEYS.filter((x) => moduleOffered(x, shop)))
    groups.set(moduleGroupKey(k), [...(groups.get(moduleGroupKey(k)) ?? []), k]);
  return (
    <>
      <PageTitle title={t("modules.title")} subtitle={onPlan ? undefined : t("modules.subtitle")} />
      <PlanPanel p={p} t={t} locale={locale} shopLocale={shop.locale} />
      <div className="grid gap-4 md:grid-cols-2">
        {[...groups.entries()].map(([group, keys]) => (
          <div key={group} className="card">
            <div className="border-b border-line px-4 py-2 text-xs font-medium tracking-wide text-muted uppercase">
              {t(group)}
            </div>
            <ul className="divide-y divide-line">
              {keys.map((k) => {
                const d = moduleDef(k);
                const on = shop.modules[k];
                const planned = d.status !== "available";
                const tier = onPlan ? tierOf(niche, k) : null;
                return (
                  <li
                    key={k}
                    className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        {t(moduleTitleKey(k))}{" "}
                        {on ? (
                          <Badge tone="ok">{onPlan ? t("plan.included") : t("modules.on")}</Badge>
                        ) : planned ? (
                          <Badge>{t("modules.soon")}</Badge>
                        ) : d.price === null ? (
                          <Badge tone="accent">{t("modules.included")}</Badge>
                        ) : tier ? (
                          <Badge tone="accent">
                            {t("plan.inTier", { tier: TIER_TITLES[tier] })}
                          </Badge>
                        ) : null}
                      </div>
                      <div className="text-xs text-muted">{t(moduleDescKey(k))}</div>
                    </div>
                    {!onPlan && !on && !planned && (
                      <button
                        className="btn-secondary shrink-0 text-xs"
                        disabled={req.busy || requested.has(k)}
                        onClick={() => void req.run(k).catch(() => {})}
                      >
                        {requested.has(k)
                          ? t("modules.requested")
                          : d.price
                            ? t("modules.connectFor", {
                                price: d.price.toLocaleString(locale),
                              })
                            : t("modules.connect")}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </>
  );
}
