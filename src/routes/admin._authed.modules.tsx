import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { requestModuleFn } from "@/app/admin/admin.functions";
import { adminT, intlLocale } from "@/app/i18n/admin";
import { Badge, PageTitle, useAction } from "@/app/ui";
import { MODULE_KEYS, moduleDef, type ModuleKey } from "@/core/modules/registry";

export const Route = createFileRoute("/admin/_authed/modules")({ component: ModulesPage });

function ModulesPage() {
  const { shop } = Route.useRouteContext();
  const t = adminT(shop.locale);
  const [requested, setRequested] = useState<Set<string>>(new Set());
  const req = useAction(async (key: ModuleKey) => {
    await requestModuleFn({ data: { key } });
    setRequested((s) => new Set(s).add(key));
  });
  const groups = new Map<string, ModuleKey[]>();
  for (const k of MODULE_KEYS)
    groups.set(moduleDef(k).group, [...(groups.get(moduleDef(k).group) ?? []), k]);
  return (
    <>
      <PageTitle title={t("modules.title")} subtitle={t("modules.subtitle")} />
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
                return (
                  <li
                    key={k}
                    className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        {d.title}{" "}
                        {on ? (
                          <Badge tone="ok">{t("modules.on")}</Badge>
                        ) : planned ? (
                          <Badge>{t("modules.soon")}</Badge>
                        ) : d.price === null ? (
                          <Badge tone="accent">{t("modules.included")}</Badge>
                        ) : null}
                      </div>
                      <div className="text-xs text-muted">{d.desc}</div>
                    </div>
                    {!on && !planned && (
                      <button
                        className="btn-secondary shrink-0 text-xs"
                        disabled={req.busy || requested.has(k)}
                        onClick={() => void req.run(k).catch(() => {})}
                      >
                        {requested.has(k)
                          ? t("modules.requested")
                          : d.price
                            ? t("modules.connectFor", {
                                price: d.price.toLocaleString(intlLocale(shop.locale)),
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
