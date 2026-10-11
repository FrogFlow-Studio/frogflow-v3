import { HelpTip } from "@/app/admin/help-panel";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { CostEditor } from "@/app/admin/cost-editor";
import { costListFn } from "@/app/admin/cost.functions";
import { adminT } from "@/app/i18n/admin";
import { Badge, Card, PageTitle } from "@/app/ui";
import { canEdit } from "@/core/auth/roles";
import { formatMoney } from "@/core/money/money";

export const Route = createFileRoute("/admin/_authed/cost")({
  beforeLoad: ({ context }) => {
    if (!context.shop.modules.profit) throw redirect({ to: "/admin" });
  },
  loader: () => costListFn(),
  component: CostPage,
});

/** Себестоимость всех товаров одной страницей — её правит и бухгалтер. */
function CostPage() {
  const { currency, rows, staleCurrency } = Route.useLoaderData();
  const { shop } = Route.useRouteContext();
  const t = adminT(shop.locale);
  const canWrite = canEdit(shop.role) || shop.role === "accountant";
  const [query, setQuery] = useState("");
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [costs, setCosts] = useState(() => new Map(rows.map((r) => [r.id, r.cost])));
  const missing = rows.filter((r) => costs.get(r.id) === null).length;
  const shown = rows.filter(
    (r) =>
      r.name.toLowerCase().includes(query.trim().toLowerCase()) &&
      (!onlyMissing || costs.get(r.id) === null),
  );
  return (
    <>
      <PageTitle title={t("cost.title")} subtitle={t("cost.intro")} />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          className="input w-64"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("common.search")}
          aria-label={t("common.search")}
        />
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={onlyMissing}
            onChange={(e) => setOnlyMissing(e.target.checked)}
          />
          {t("cost.onlyMissing")}
          <HelpTip article="cost" anchor="only-missing" />
        </label>
        <Badge tone={missing ? "warn" : "ok"}>
          {t("cost.missing", { n: missing, total: rows.length })}
        </Badge>
      </div>
      {staleCurrency > 0 && (
        <p className="mb-3 text-sm text-warn">{t("cost.staleNote", { n: staleCurrency })}</p>
      )}
      {rows.length === 0 && <p className="text-sm text-muted">{t("cost.empty")}</p>}
      <div className="grid gap-3">
        {shown.map((r) => (
          <Card
            key={r.id}
            title={
              <span>
                {r.name}{" "}
                <span className="text-xs text-muted">{formatMoney(r.price, r.currency)}</span>
              </span>
            }
          >
            <CostEditor
              productId={r.id}
              variants={r.variants.map((v) => ({ name: v.name }))}
              cost={r.cost}
              currency={currency}
              canWrite={canWrite}
              t={t}
              onSaved={(c) => setCosts(new Map(costs).set(r.id, c))}
            />
          </Card>
        ))}
      </div>
    </>
  );
}
