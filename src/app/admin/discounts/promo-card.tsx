import { useRouteContext, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { deletePromoCodeFn, promoCodesFn, savePromoCodeFn } from "@/app/admin/promos.functions";
import { adminT, intlLocale } from "@/app/i18n/admin";
import { Badge, Card, Empty, ErrorBox, Field, useAction } from "@/app/ui";

/** Промокоды. */

type Promo = Awaited<ReturnType<typeof promoCodesFn>>[number];

export function PromoCard({ promos }: { promos: Promo[] }) {
  const router = useRouter();
  const { shop } = useRouteContext({ from: "/admin/_authed" });
  const t = adminT(shop.locale);
  const [editing, setEditing] = useState<Promo | "new" | null>(null);
  const save = useAction(async (f: FormData, id: string | null) => {
    const mu = String(f.get("maxUses")).trim();
    const vu = String(f.get("validUntil")).trim();
    await savePromoCodeFn({
      data: {
        id,
        code: String(f.get("code")),
        discountType: String(f.get("discountType")) as "percent" | "fixed",
        discountValue: Number(f.get("discountValue")),
        maxUses: mu ? Number(mu) : null,
        validUntil: vu || null,
        isActive: f.get("isActive") === "on",
        oncePerBuyer: f.get("oncePerBuyer") === "on",
      },
    });
    setEditing(null);
    await router.invalidate();
  });
  const del = useAction(async (id: string) => {
    if (!confirm(t("discounts.promo.deleteConfirm"))) return;
    await deletePromoCodeFn({ data: { id } });
    await router.invalidate();
  });
  const cur = editing === "new" ? null : editing;
  return (
    <Card
      title={t("discounts.promo.title")}
      actions={
        <button className="btn-secondary text-xs" onClick={() => setEditing("new")}>
          {t("discounts.promo.new")}
        </button>
      }
    >
      {promos.length === 0 ? (
        <Empty>{t("discounts.promo.empty")}</Empty>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>{t("discounts.col.code")}</th>
              <th>{t("discounts.col.discount")}</th>
              <th>{t("discounts.col.uses")}</th>
              <th>{t("discounts.col.validUntil")}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {promos.map((p) => {
              const expired = p.valid_until && new Date(p.valid_until) < new Date();
              const exhausted = p.max_uses !== null && p.used_count >= p.max_uses;
              return (
                <tr key={p.id}>
                  <td className="font-mono font-medium">
                    {p.code} {!p.is_active && <Badge>{t("discounts.promo.off")}</Badge>}
                    {expired && <Badge tone="warn">{t("discounts.promo.expired")}</Badge>}
                    {exhausted && <Badge tone="warn">{t("discounts.promo.exhausted")}</Badge>}
                    {p.once_per_buyer && <Badge>{t("discounts.promo.onceBadge")}</Badge>}
                  </td>
                  <td>
                    {p.discount_type === "percent"
                      ? `${Number(p.discount_value)} %`
                      : `${Number(p.discount_value)} ₸`}
                  </td>
                  <td className="tabular-nums">
                    {p.used_count}
                    {p.max_uses !== null ? ` / ${p.max_uses}` : ""}
                  </td>
                  <td className="text-muted">
                    {p.valid_until
                      ? new Date(p.valid_until).toLocaleDateString(intlLocale(shop.locale))
                      : t("discounts.promo.noExpiry")}
                  </td>
                  <td className="text-right whitespace-nowrap">
                    <button className="btn-ghost text-xs" onClick={() => setEditing(p)}>
                      {t("common.edit")}
                    </button>
                    <button
                      className="btn-ghost text-xs text-danger"
                      onClick={() => void del.run(p.id).catch(() => {})}
                    >
                      {t("common.delete")}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <ErrorBox error={del.error} />
      {editing !== null && (
        <form
          key={cur?.id ?? "new"}
          className="mt-4 space-y-3 border-t border-line pt-4"
          onSubmit={(e) => {
            e.preventDefault();
            void save.run(new FormData(e.currentTarget), cur?.id ?? null).catch(() => {});
          }}
        >
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label={t("discounts.col.code")}>
              <input
                className="input font-mono uppercase"
                name="code"
                defaultValue={cur?.code ?? ""}
                required
                minLength={2}
                maxLength={40}
                placeholder="SALE10"
              />
            </Field>
            <Field label={t("discounts.promo.type")}>
              <select
                className="input"
                name="discountType"
                defaultValue={cur?.discount_type ?? "percent"}
              >
                <option value="percent">{t("discounts.promo.typePercent")}</option>
                <option value="fixed">{t("discounts.promo.typeFixed")}</option>
              </select>
            </Field>
            <Field label={t("discounts.promo.value")}>
              <input
                className="input"
                name="discountValue"
                type="number"
                min={0.01}
                step="0.01"
                defaultValue={cur ? Number(cur.discount_value) : ""}
                required
              />
            </Field>
            <Field label={t("discounts.promo.maxUses")} hint={t("discounts.promo.maxUsesHint")}>
              <input
                className="input"
                name="maxUses"
                type="number"
                min={1}
                defaultValue={cur?.max_uses ?? ""}
              />
            </Field>
            <Field label={t("discounts.col.validUntil")}>
              <input
                className="input"
                name="validUntil"
                type="date"
                defaultValue={cur?.valid_until ? cur.valid_until.slice(0, 10) : ""}
              />
            </Field>
            <label className="flex items-center gap-2 self-end pb-2 text-sm">
              <input type="checkbox" name="isActive" defaultChecked={cur?.is_active ?? true} />{" "}
              {t("discounts.promo.active")}
            </label>
            <label className="flex items-center gap-2 self-end pb-2 text-sm">
              <input
                type="checkbox"
                name="oncePerBuyer"
                defaultChecked={cur?.once_per_buyer ?? false}
              />{" "}
              {t("discounts.promo.oncePerBuyer")}
            </label>
          </div>
          <ErrorBox error={save.error} />
          <div className="flex gap-2">
            <button className="btn-primary" disabled={save.busy}>
              {t("common.save")}
            </button>
            <button type="button" className="btn-ghost" onClick={() => setEditing(null)}>
              {t("common.cancel")}
            </button>
          </div>
        </form>
      )}
    </Card>
  );
}
