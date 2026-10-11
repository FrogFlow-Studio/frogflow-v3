import { HelpTip } from "@/app/admin/help-panel";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { createManualOrderFn, manualOrderFormFn } from "@/app/admin/orders.functions";
import { adminT } from "@/app/i18n/admin";
import { ErrorBox, Field, useAction } from "@/app/ui";
import { formatMoney } from "@/core/money/money";
import { addDaysToIso } from "@/core/fulfillment/pure";
import { isClosedDay } from "@/core/fulfillment/closed-days";

export const Route = createFileRoute("/admin/_authed/orders/new")({
  loader: () => manualOrderFormFn(),
  component: ManualOrderPage,
});

type Line = { productId: string; variantId: string; quantity: number };

/** Заказ по телефону или из переписки мимо бота — только физические товары. */
function ManualOrderPage() {
  const { products, zones, today, closedWeekdays, closedRanges, fullDays } = Route.useLoaderData();
  const { shop } = Route.useRouteContext();
  const t = adminT(shop.locale);
  const router = useRouter();
  const [lines, setLines] = useState<Line[]>([
    { productId: products[0]?.id ?? "", variantId: "", quantity: 1 },
  ]);
  const [type, setType] = useState<"pickup" | "delivery">("pickup");
  const [zoneId, setZoneId] = useState("");
  const [paid, setPaid] = useState("");
  const [pickedDate, setPickedDate] = useState("");
  const byId = new Map(products.map((p) => [p.id, p]));

  const unitOf = (l: Line) => {
    const p = byId.get(l.productId);
    if (!p) return 0;
    const v = p.variants.find((x) => x.id === l.variantId);
    return v ? v.price : p.variants.length > 0 ? 0 : p.price;
  };
  const zone = type === "delivery" ? zones.find((z) => z.id === zoneId) : undefined;
  const total = lines.reduce((s, l) => s + unitOf(l) * l.quantity, 0) + (zone?.price ?? 0);
  const currency = byId.get(lines[0]?.productId ?? "")?.currency ?? "KZT";
  const leadDays = Math.max(0, ...lines.map((l) => byId.get(l.productId)?.leadDays ?? 0));
  const minDate = addDaysToIso(today, leadDays);

  const setLine = (i: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const create = useAction(async (form: FormData) => {
    const str = (k: string) => String(form.get(k) ?? "").trim() || null;
    const r = await createManualOrderFn({
      data: {
        displayName: String(form.get("name") ?? "").trim(),
        contact: str("phone"),
        items: lines.map((l) => ({
          productId: l.productId,
          variantId: l.variantId || null,
          quantity: l.quantity,
        })),
        fulfillmentType: type,
        fulfillmentAt: str("at"),
        address: type === "delivery" ? str("address") : null,
        note: str("note"),
        deliveryZoneId: type === "delivery" && zoneId ? zoneId : null,
        paidAmount: Number(paid.replace(",", ".")) || 0,
      },
    });
    await router.navigate({ to: "/admin/orders/$id", params: { id: String(r.id) } });
  });

  return (
    <div
      className="fixed inset-0 z-30 flex justify-end bg-black/30"
      onClick={() => void router.navigate({ to: "/admin/orders" })}
    >
      <div
        className="h-full w-full max-w-xl overflow-y-auto bg-bg p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2 flex items-start justify-between">
          <h2 className="text-lg font-semibold">{t("manual.title")}</h2>
          <Link to="/admin/orders" className="btn-ghost">
            ✕
          </Link>
        </div>
        <p className="mb-4 text-sm text-muted">{t("manual.hint")}</p>
        {products.length === 0 ? (
          <p className="text-sm">{t("manual.noProducts")}</p>
        ) : (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void create.run(new FormData(e.currentTarget)).catch(() => {});
            }}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t("manual.name")}>
                <input className="input" name="name" required maxLength={120} />
              </Field>
              <Field
                label={t("manual.phone")}
                hint={t("manual.phoneHint")}
                help={<HelpTip article="orders" anchor="manual-order" />}
              >
                <input className="input" name="phone" inputMode="tel" maxLength={40} />
              </Field>
            </div>

            <div>
              <span className="label">{t("manual.items")}</span>
              <div className="space-y-2">
                {lines.map((l, i) => {
                  const p = byId.get(l.productId);
                  return (
                    <div key={i} className="flex flex-wrap items-center gap-2">
                      <select
                        className="input min-w-0 flex-1"
                        aria-label={t("manual.product")}
                        value={l.productId}
                        onChange={(e) => setLine(i, { productId: e.target.value, variantId: "" })}
                      >
                        {products.map((x) => (
                          <option key={x.id} value={x.id}>
                            {x.name}
                            {x.variants.length === 0
                              ? ` · ${formatMoney(x.price, x.currency)}`
                              : ""}
                            {x.stock !== null ? ` (${x.stock})` : ""}
                          </option>
                        ))}
                      </select>
                      {p && p.variants.length > 0 && (
                        <select
                          className="input w-44"
                          aria-label={t("manual.variant")}
                          required
                          value={l.variantId}
                          onChange={(e) => setLine(i, { variantId: e.target.value })}
                        >
                          <option value="">{t("manual.variant")}</option>
                          {p.variants.map((v) => (
                            <option key={v.id} value={v.id}>
                              {v.name} · {formatMoney(v.price, p.currency)}
                            </option>
                          ))}
                        </select>
                      )}
                      <input
                        className="input w-20"
                        type="number"
                        min={1}
                        max={99}
                        aria-label={t("manual.qty")}
                        value={l.quantity}
                        onChange={(e) =>
                          setLine(i, { quantity: Math.max(1, Number(e.target.value) || 1) })
                        }
                      />
                      {lines.length > 1 && (
                        <button
                          type="button"
                          className="btn-ghost text-xs"
                          onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}
                        >
                          {t("manual.remove")}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
              {lines.length < 20 && (
                <button
                  type="button"
                  className="btn-ghost mt-2 text-xs"
                  onClick={() =>
                    setLines((ls) => [
                      ...ls,
                      { productId: products[0]!.id, variantId: "", quantity: 1 },
                    ])
                  }
                >
                  {t("manual.addItem")}
                </button>
              )}
            </div>

            <div className="flex gap-2">
              {(["pickup", "delivery"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  className={`badge cursor-pointer ${type === k ? "border-accent bg-accent/10 text-accent" : ""}`}
                  onClick={() => setType(k)}
                >
                  {k === "delivery" ? t("order.delivery") : t("order.pickup")}
                </button>
              ))}
            </div>
            <Field
              label={t("physical.date")}
              hint={leadDays > 0 ? t("manual.minDate", { date: minDate }) : undefined}
            >
              <input
                className="input"
                type="date"
                name="at"
                min={minDate}
                onChange={(e) => setPickedDate(e.target.value)}
              />
            </Field>
            {pickedDate &&
              (isClosedDay(pickedDate, { weekdays: closedWeekdays, ranges: closedRanges }) ? (
                <p className="text-xs text-warn">{t("manual.dateClosedWarn")}</p>
              ) : fullDays.includes(pickedDate) ? (
                <p className="text-xs text-warn">{t("manual.dateFullWarn")}</p>
              ) : null)}
            {type === "delivery" && (
              <>
                {zones.length > 0 && (
                  <Field label={t("physical.zone")}>
                    <select
                      className="input"
                      required
                      value={zoneId}
                      onChange={(e) => setZoneId(e.target.value)}
                    >
                      <option value="">{t("physical.zonePick")}</option>
                      {zones.map((z) => (
                        <option key={z.id} value={z.id}>
                          {z.name} · {formatMoney(z.price, z.currency)}
                        </option>
                      ))}
                    </select>
                  </Field>
                )}
                <Field label={t("physical.address")}>
                  <input className="input" name="address" maxLength={500} />
                </Field>
              </>
            )}
            <Field label={t("physical.comment")}>
              <input className="input" name="note" maxLength={500} />
            </Field>
            <Field
              label={t("manual.paid")}
              hint={t("manual.paidHint")}
              help={<HelpTip article="orders" anchor="manual-paid" />}
            >
              <input
                className="input w-40"
                inputMode="decimal"
                value={paid}
                onChange={(e) => setPaid(e.target.value)}
                placeholder="0"
              />
            </Field>
            <p className="font-medium tabular-nums">
              {t("manual.total", { sum: formatMoney(total, currency) })}
            </p>
            <ErrorBox error={create.error} />
            <button className="btn-primary" disabled={create.busy}>
              {t("manual.create")}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
