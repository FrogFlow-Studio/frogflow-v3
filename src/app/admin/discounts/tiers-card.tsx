import { useRouteContext, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { saveLoyaltyTiersFn } from "@/app/admin/loyalty.functions";
import { adminT } from "@/app/i18n/admin";
import { Card, ErrorBox, Field, useAction } from "@/app/ui";
import { HelpTip } from "@/app/admin/help-panel";

/** Уровни лояльности. */

type TierRow = { name: string; from: string; percent: string };

export function TiersCard({ tiers }: { tiers: { name: string; from: number; percent: number }[] }) {
  const router = useRouter();
  const { shop } = useRouteContext({ from: "/admin/_authed" });
  const t = adminT(shop.locale);
  const [rows, setRows] = useState<TierRow[]>(
    tiers.map((x) => ({ name: x.name, from: String(x.from), percent: String(x.percent) })),
  );
  const set = (i: number, patch: Partial<TierRow>) =>
    setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const save = useAction(async () => {
    await saveLoyaltyTiersFn({
      data: {
        tiers: rows.map((x) => ({
          name: x.name,
          from: Number(x.from),
          percent: Number(x.percent),
        })),
      },
    });
    await router.invalidate();
  });
  return (
    <Card
      title={
        <span className="flex items-center gap-1.5">
          {t("discounts.tiers.title")}
          <HelpTip article="discounts" anchor="tiers" />
        </span>
      }
    >
      <p className="mb-3 text-sm text-muted">{t("discounts.tiers.intro")}</p>
      {rows.length === 0 && <p className="mb-3 text-sm text-muted">{t("discounts.tiers.empty")}</p>}
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          void save.run().catch(() => {});
        }}
      >
        {rows.map((r, i) => (
          <div key={i} className="flex flex-wrap items-end gap-2">
            <Field label={t("discounts.tiers.name")}>
              <input
                className="input w-40"
                maxLength={40}
                value={r.name}
                onChange={(e) => set(i, { name: e.target.value })}
              />
            </Field>
            <Field label={t("discounts.tiers.from")}>
              <input
                className="input w-28"
                type="number"
                min={0}
                value={r.from}
                onChange={(e) => set(i, { from: e.target.value })}
              />
            </Field>
            <Field label={t("discounts.tiers.percent")}>
              <input
                className="input w-24"
                type="number"
                min={1}
                max={100}
                value={r.percent}
                onChange={(e) => set(i, { percent: e.target.value })}
              />
            </Field>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setRows((x) => x.filter((_, j) => j !== i))}
            >
              {t("discounts.tiers.remove")}
            </button>
          </div>
        ))}
        <div className="flex gap-2">
          {rows.length < 4 && (
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setRows((x) => [...x, { name: "", from: "0", percent: "5" }])}
            >
              {t("discounts.tiers.add")}
            </button>
          )}
          <button className="btn-secondary" disabled={save.busy}>
            {t("discounts.tiers.save")}
          </button>
        </div>
      </form>
      <ErrorBox error={save.error} />
    </Card>
  );
}
