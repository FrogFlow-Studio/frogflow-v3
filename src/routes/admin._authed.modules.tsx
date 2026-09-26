import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { myPlanFn, requestModuleFn, requestPlanFn } from "@/app/admin/admin.functions";
import { adminT, intlLocale, type AdminT } from "@/app/i18n/admin";
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

/** Нижний уровень ниши, в который входит модуль; null — ни в одном плане. */
function tierOf(niche: PlanNiche, key: ModuleKey): PlanTier | null {
  return PLAN_TIERS.find((t) => planModules(niche, t).has(key)) ?? null;
}

function PlanPanel({ p, t, locale }: { p: MyPlan; t: AdminT; locale: string }) {
  const router = useRouter();
  const [sent, setSent] = useState<Set<string>>(new Set(p.pending));
  const req = useAction(async (key: PlanRequestKey) => {
    await requestPlanFn({ data: { key } });
    setSent((s) => new Set(s).add(key));
    await router.invalidate();
  });
  const n = (x: number) => x.toLocaleString(locale);
  const usageLine = (used: number, limit: number | null | undefined) =>
    limit === null || limit === undefined
      ? t("plan.unlimited", { used: n(used) })
      : t("plan.of", { used: n(used), limit: n(limit) });
  if (p.plan === "custom")
    return (
      <Card title={t("plan.title")} className="mb-4">
        <p className="text-sm">{t("plan.custom")}</p>
      </Card>
    );
  if (!p.plan) return null;
  const current = p.plan;
  const higher = PLAN_TIERS.slice(PLAN_TIERS.indexOf(current) + 1);
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
            {TIER_TITLES[current]} · {t("plan.perMonth", { price: n(p.prices.monthly[current]) })}
          </div>
          {p.period === "year" && <div className="text-muted">{t("plan.perYear")}</div>}
          {p.trialUntil && (
            <div className="text-muted">
              {t("plan.trial", {
                date: new Date(p.trialUntil).toLocaleDateString(locale),
              })}
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
          <p className="text-xs text-muted">{t("plan.limitHint")}</p>
        </div>
      </div>
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
                  : `${t("plan.upgradeTo", { tier: TIER_TITLES[tier] })} · ${n(p.prices.monthly[tier])} ₸`}
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
  const groups = new Map<string, ModuleKey[]>();
  for (const k of MODULE_KEYS)
    groups.set(moduleDef(k).group, [...(groups.get(moduleDef(k).group) ?? []), k]);
  return (
    <>
      <PageTitle title={t("modules.title")} subtitle={onPlan ? undefined : t("modules.subtitle")} />
      <PlanPanel p={p} t={t} locale={locale} />
      <div className="grid gap-4 md:grid-cols-2">
        {[...groups.entries()].map(([group, keys]) => (
          <div key={group} className="card">
            <div className="border-b border-line px-4 py-2 text-xs font-medium tracking-wide text-muted uppercase">
              {group}
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
                        {d.title}{" "}
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
                      <div className="text-xs text-muted">{d.desc}</div>
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
