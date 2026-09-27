import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import {
  orderActionFn,
  orderFn,
  orderNoteFn,
  recordPaymentFn,
  updateFulfillmentFn,
} from "@/app/admin/admin.functions";
import { adminT, intlLocale } from "@/app/i18n/admin";
import { Badge, Card, ErrorBox, Field, useAction } from "@/app/ui";
import { describeOrderEvent } from "@/core/orders/events";
import { formatMoney } from "@/core/money/money";
import { displayNo, itemLanguages } from "@/core/orders/pure";
import { OrderStatus } from "./admin._authed.orders";

export const Route = createFileRoute("/admin/_authed/orders/$id")({
  loader: ({ params }) => orderFn({ data: { id: Number(params.id) } }),
  component: OrderPage,
});

function OrderPage() {
  const { order: o, proofUrl, events, zones, dueNow } = Route.useLoaderData();
  const { shop } = Route.useRouteContext();
  const t = adminT(shop.locale);
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  const act = useAction(async (action: "confirm" | "reject" | "next" | "prev" | "remind") => {
    if (action === "reject" && !confirm(t("order.rejectConfirm"))) return;
    const r = await orderActionFn({ data: { id: o.id, action } });
    setMsg(r.message);
    await router.invalidate();
  });
  const note = useAction(async (text: string) => {
    await orderNoteFn({ data: { id: o.id, note: text || null } });
    await router.invalidate();
  });
  const no = displayNo(o);
  const physical = o.fulfillment_kind === "physical";
  const canConfirm = ["awaiting_payment", "awaiting_confirmation", "paid"].includes(o.status);
  const canReject = [
    ...["awaiting_payment", "awaiting_confirmation", "paid"],
    "accepted",
    "in_production",
    "ready",
  ].includes(o.status);
  return (
    <div
      className="fixed inset-0 z-30 flex justify-end bg-black/30"
      onClick={() => void router.navigate({ to: "/admin/orders" })}
    >
      <div
        className="h-full w-full max-w-xl overflow-y-auto bg-bg p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              {t("order.title", { no })} <OrderStatus status={o.status} />
            </h2>
            <p className="text-sm text-muted">
              {new Date(o.created_at).toLocaleString(intlLocale(shop.locale))} ·{" "}
              {o.platform === "web" ? t("order.platformWeb") : o.platform} ·{" "}
              {physical ? t("order.physical") : t("order.digital")}
            </p>
          </div>
          <Link to="/admin/orders" className="btn-ghost">
            ✕
          </Link>
        </div>

        <div className="mb-4 flex flex-wrap gap-2">
          {canConfirm && (
            <button
              className="btn-primary"
              disabled={act.busy}
              onClick={() => void act.run("confirm").catch(() => {})}
            >
              {physical ? t("order.acceptPhysical") : t("order.confirmDeliver")}
            </button>
          )}
          {physical &&
            (o.status === "accepted" || o.status === "in_production" || o.status === "ready") && (
              <button
                className="btn-secondary"
                disabled={act.busy}
                onClick={() => void act.run("next").catch(() => {})}
              >
                {o.status === "accepted"
                  ? t("order.toProduction")
                  : o.status === "in_production"
                    ? t("order.toReady")
                    : t("order.toDelivered")}
              </button>
            )}
          {physical && (o.status === "in_production" || o.status === "ready") && (
            <button
              className="btn-ghost"
              disabled={act.busy}
              onClick={() => void act.run("prev").catch(() => {})}
            >
              {t("order.stepBack")}
            </button>
          )}
          {o.status === "awaiting_payment" && (
            <button
              className="btn-secondary"
              disabled={act.busy}
              onClick={() => void act.run("remind").catch(() => {})}
            >
              {t("order.remind")}
            </button>
          )}
          {canReject && (
            <button
              className="btn-ghost text-danger"
              disabled={act.busy}
              onClick={() => void act.run("reject").catch(() => {})}
            >
              {t("order.reject")}
            </button>
          )}
        </div>
        {msg && <p className="mb-3 text-sm text-muted">{msg}</p>}
        <ErrorBox error={act.error} />

        <div className="space-y-4">
          <Card title={t("order.customer")}>
            <dl className="grid grid-cols-[120px_1fr] gap-y-1 text-sm">
              <dt className="text-muted">{t("order.name")}</dt>
              <dd>
                {o.display_name} {o.username && <span className="text-muted">@{o.username}</span>}
              </dd>
              <dt className="text-muted">{t("order.phone")}</dt>
              <dd>{o.contact ?? "—"}</dd>
              <dt className="text-muted">{t("order.email")}</dt>
              <dd>{o.customer_email ?? "—"}</dd>
              <dt className="text-muted">{t("order.country")}</dt>
              <dd>{o.country_name ?? "—"}</dd>
              {physical && (
                <>
                  <dt className="text-muted">{t("order.fulfillment")}</dt>
                  <dd>
                    {o.fulfillment_type === "delivery" ? t("order.delivery") : t("order.pickup")}{" "}
                    {o.fulfillment_at
                      ? new Date(o.fulfillment_at).toLocaleDateString(intlLocale(shop.locale), {
                          timeZone: "UTC",
                        })
                      : ""}
                    {o.delivery_zone_name && (
                      <span className="text-muted"> · {o.delivery_zone_name}</span>
                    )}
                    {o.fulfillment_address && <div>{o.fulfillment_address}</div>}
                    {o.fulfillment_note && <div className="text-muted">{o.fulfillment_note}</div>}
                  </dd>
                </>
              )}
            </dl>
            {physical && !["delivered", "rejected", "cancelled"].includes(o.status) && (
              <FulfillmentEditor order={o} zones={zones} />
            )}
          </Card>
          {physical && <PaymentCard order={o} dueNow={dueNow} />}
          <Card title={t("order.items")}>
            <table className="table">
              <tbody>
                {(o.order_items ?? []).map((i) => (
                  <tr key={i.id}>
                    <td>
                      {i.name_snapshot}
                      <div className="text-xs text-muted">
                        {t("order.files", {
                          langs: itemLanguages(i).join(", ") || t("order.noFiles"),
                        })}
                      </div>
                    </td>
                    <td className="text-right whitespace-nowrap tabular-nums">
                      {i.quantity} × {formatMoney(i.price_snapshot, o.currency)}
                    </td>
                  </tr>
                ))}
                <tr>
                  <td className="font-medium">{t("common.total")}</td>
                  <td className="text-right font-medium tabular-nums">
                    {formatMoney(o.total, o.currency)}
                  </td>
                </tr>
              </tbody>
            </table>
            {Number(o.discount_amount) > 0 && (
              <p className="mt-1 text-xs text-muted">
                {t("order.discount", { sum: formatMoney(o.discount_amount, o.currency) })}
              </p>
            )}
          </Card>
          <Card title={t("order.proof")}>
            {proofUrl ? (
              /\.(pdf)(\?|$)/i.test(o.payment_proof_path ?? "") ? (
                <a
                  className="text-accent hover:underline"
                  href={proofUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  {t("order.openPdf")}
                </a>
              ) : (
                <a href={proofUrl} target="_blank" rel="noreferrer">
                  <img
                    src={proofUrl}
                    alt={t("order.proof")}
                    className="max-h-96 rounded-md border border-line"
                  />
                </a>
              )
            ) : (
              <p className="text-sm text-muted">{t("order.noProof")}</p>
            )}
          </Card>
          <Card title={t("order.history")}>
            {events.length === 0 ? (
              <p className="text-sm text-muted">{t("order.noEvents")}</p>
            ) : (
              <ol className="space-y-1.5 text-sm">
                {events.map((e) => {
                  const d = describeOrderEvent(e);
                  return (
                    <li key={e.id} className="flex items-start gap-2">
                      <span className="w-28 shrink-0 text-xs text-muted tabular-nums">
                        {new Date(e.at).toLocaleString(intlLocale(shop.locale), {
                          day: "2-digit",
                          month: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                      <span
                        className={
                          d.tone === "danger"
                            ? "text-danger"
                            : d.tone === "ok"
                              ? "text-ok"
                              : d.tone === "warn"
                                ? "text-warn"
                                : ""
                        }
                      >
                        {d.text}
                      </span>
                    </li>
                  );
                })}
              </ol>
            )}
            {o.status === "awaiting_confirmation" &&
              o.admin_note?.startsWith("Выдача не удалась") && (
                <div className="mt-3">
                  <Badge tone="danger">{o.admin_note}</Badge>
                </div>
              )}
          </Card>
          <Card title={t("order.note")}>
            <form
              className="space-y-2"
              onSubmit={(e) => {
                e.preventDefault();
                void note.run(String(new FormData(e.currentTarget).get("note"))).catch(() => {});
              }}
            >
              <Field label={t("order.noteHint")}>
                <textarea
                  className="input"
                  name="note"
                  rows={2}
                  defaultValue={o.admin_note ?? ""}
                />
              </Field>
              <button className="btn-secondary" disabled={note.busy}>
                {t("common.save")}
              </button>
            </form>
          </Card>
        </div>
      </div>
    </div>
  );
}

type Order = Awaited<ReturnType<typeof orderFn>>["order"];
type Zone = { id: string; name: string; price: number };

/** Внесено / осталось по физическому заказу и ручное внесение оплаты. */
function PaymentCard({ order: o, dueNow }: { order: Order; dueNow: number }) {
  const { shop } = Route.useRouteContext();
  const t = adminT(shop.locale);
  const router = useRouter();
  const paid = Number(o.paid_amount) || 0;
  const remaining = Math.max(0, Number(o.total) - paid);
  const [amount, setAmount] = useState("");
  const pay = useAction(async (sum: number) => {
    await recordPaymentFn({ data: { id: o.id, amount: sum } });
    setAmount("");
    await router.invalidate();
  });
  const closed = o.status === "rejected" || o.status === "cancelled";
  return (
    <Card title={t("physical.payTitle")}>
      <dl className="grid grid-cols-[120px_1fr] gap-y-1 text-sm">
        <dt className="text-muted">{t("physical.paid")}</dt>
        <dd className="tabular-nums">{formatMoney(paid, o.currency)}</dd>
        <dt className="text-muted">{t("physical.remaining")}</dt>
        <dd className="tabular-nums">
          {remaining > 0 ? (
            formatMoney(remaining, o.currency)
          ) : (
            <Badge tone="ok">{t("physical.paidFull")}</Badge>
          )}
        </dd>
      </dl>
      {remaining > 0 && dueNow > paid && dueNow < Number(o.total) && (
        <p className="mt-1 text-xs text-muted">
          {t("physical.dueNow", { sum: formatMoney(dueNow, o.currency) })}
        </p>
      )}
      {remaining > 0 && !closed && (
        <form
          className="mt-3 flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const sum = Number(amount.replace(",", "."));
            if (sum > 0) void pay.run(sum).catch(() => {});
          }}
        >
          <label className="block">
            <span className="label">{t("physical.amount")}</span>
            <input
              className="input w-36"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </label>
          <button className="btn-primary" disabled={pay.busy || !(Number(amount) > 0)}>
            {t("physical.record")}
          </button>
          <button
            type="button"
            className="btn-ghost"
            disabled={pay.busy}
            onClick={() => void pay.run(remaining).catch(() => {})}
          >
            {t("physical.recordAll")} · {formatMoney(remaining, o.currency)}
          </button>
          <p className="w-full text-xs text-muted">{t("physical.recordHint")}</p>
        </form>
      )}
      <ErrorBox error={pay.error} />
    </Card>
  );
}

/** Перенос даты, адрес, комментарий, доставка ↔ самовывоз. */
function FulfillmentEditor({ order: o, zones }: { order: Order; zones: Zone[] }) {
  const { shop } = Route.useRouteContext();
  const t = adminT(shop.locale);
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<"pickup" | "delivery">(
    o.fulfillment_type === "delivery" ? "delivery" : "pickup",
  );
  const save = useAction(async (form: FormData) => {
    const str = (k: string) => String(form.get(k) ?? "").trim() || null;
    await updateFulfillmentFn({
      data: {
        id: o.id,
        fulfillmentAt: str("at"),
        address: type === "delivery" ? str("address") : null,
        note: str("note"),
        fulfillmentType: type,
        deliveryZoneId: type === "delivery" ? str("zone") : null,
      },
    });
    setOpen(false);
    await router.invalidate();
  });
  if (!open)
    return (
      <button type="button" className="btn-ghost mt-2 text-xs" onClick={() => setOpen(true)}>
        {t("physical.edit")}
      </button>
    );
  return (
    <form
      className="mt-3 space-y-2 border-t border-line pt-3"
      onSubmit={(e) => {
        e.preventDefault();
        void save.run(new FormData(e.currentTarget)).catch(() => {});
      }}
    >
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
      <Field label={t("physical.date")}>
        <input
          className="input"
          type="date"
          name="at"
          defaultValue={o.fulfillment_at ? o.fulfillment_at.slice(0, 10) : ""}
        />
      </Field>
      {type === "delivery" && (
        <>
          {zones.length > 0 && (
            <Field label={t("physical.zone")}>
              <select className="input" name="zone" defaultValue={o.delivery_zone_id ?? ""}>
                <option value="">{t("physical.zonePick")}</option>
                {zones.map((z) => (
                  <option key={z.id} value={z.id}>
                    {z.name} · {z.price}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field label={t("physical.address")}>
            <input className="input" name="address" defaultValue={o.fulfillment_address ?? ""} />
          </Field>
        </>
      )}
      <Field label={t("physical.comment")}>
        <input className="input" name="note" defaultValue={o.fulfillment_note ?? ""} />
      </Field>
      <p className="text-xs text-muted">{t("physical.feeHint")}</p>
      <ErrorBox error={save.error} />
      <div className="flex gap-2">
        <button className="btn-primary" disabled={save.busy}>
          {t("common.save")}
        </button>
        <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>
          {t("physical.cancel")}
        </button>
      </div>
    </form>
  );
}
