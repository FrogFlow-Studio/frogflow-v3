import { canEdit } from "@/core/auth/roles";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import {
  dispatchCourierFn,
  orderActionFn,
  orderFn,
  orderNoteFn,
  recordPaymentFn,
  refundOrderFn,
  rejectBalanceProofFn,
  sendApprovalFn,
  updateFulfillmentFn,
} from "@/app/admin/admin.functions";
import { adminT, intlLocale } from "@/app/i18n/admin";
import { Badge, Card, ErrorBox, Field, useAction } from "@/app/ui";
import { describeOrderEvent } from "@/core/orders/events";
import { formatMoney } from "@/core/money/money";
import { displayNo, itemLanguages } from "@/core/orders/pure";
import { isClosedDay, type ClosedRules } from "@/core/fulfillment/closed-days";
import { slotOf } from "@/core/fulfillment/slots";
import { OrderStatus } from "./admin._authed.orders";

export const Route = createFileRoute("/admin/_authed/orders/$id")({
  loader: ({ params }) => orderFn({ data: { id: Number(params.id) } }),
  component: OrderPage,
});

function OrderPage() {
  const {
    order: o,
    proofUrl,
    balanceProofUrl,
    balancePending,
    events,
    zones,
    dueNow,
    pageUrl,
    refunded,
    refundable,
    slots,
    closedWeekdays,
    closedRanges,
    fullDays,
    approval,
    approvalPhotoUrl,
    courier,
    gift,
  } = Route.useLoaderData();
  const [copied, setCopied] = useState(false);
  const { shop } = Route.useRouteContext();
  const t = adminT(shop.locale);
  const editable = canEdit(shop.role);
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

        {/* Бухгалтер и «просмотр» ничего не меняют: кнопок нет, сервер всё равно откажет. */}
        <div className={editable ? "mb-4 flex flex-wrap gap-2" : "hidden"}>
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
          {o.fulfillment_kind === "physical" && (
            <a href={`/admin/print/${o.id}`} target="_blank" rel="noreferrer" className="btn-ghost">
              {t("print.button")}
            </a>
          )}
          {pageUrl && (
            <button
              className="btn-ghost"
              onClick={() =>
                void navigator.clipboard
                  ?.writeText(pageUrl)
                  .then(() => setCopied(true))
                  .catch(() => window.prompt(t("order.copyLink"), pageUrl))
              }
            >
              {copied ? t("order.linkCopied") : t("order.copyLink")}
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
          {gift && (
            <Card title={t("order.gift")}>
              <dl className="grid grid-cols-[120px_1fr] gap-y-1 text-sm">
                {gift.recipient && (
                  <>
                    <dt className="text-muted">{t("order.giftRecipient")}</dt>
                    <dd>{gift.recipient}</dd>
                  </>
                )}
                {gift.message && (
                  <>
                    <dt className="text-muted">{t("order.giftMessage")}</dt>
                    <dd className="whitespace-pre-wrap">{gift.message}</dd>
                  </>
                )}
              </dl>
            </Card>
          )}
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
                    {slotOf(o.fulfillment_at, slots) && (
                      <span> · {slotOf(o.fulfillment_at, slots)}</span>
                    )}
                    {o.delivery_zone_name && (
                      <span className="text-muted"> · {o.delivery_zone_name}</span>
                    )}
                    {o.fulfillment_address && <div>{o.fulfillment_address}</div>}
                    {o.fulfillment_note && <div className="text-muted">{o.fulfillment_note}</div>}
                  </dd>
                </>
              )}
            </dl>
            {editable &&
              physical &&
              !["delivered", "rejected", "cancelled", "refunded"].includes(o.status) && (
                <FulfillmentEditor
                  order={o}
                  zones={zones}
                  slots={slots}
                  closed={{ weekdays: closedWeekdays, ranges: closedRanges }}
                  fullDays={fullDays}
                />
              )}
          </Card>
          {physical &&
            (approval.status !== "none" ||
              (editable && ["accepted", "in_production", "ready"].includes(o.status))) && (
              <ApprovalCard
                order={o}
                approval={approval}
                photoUrl={approvalPhotoUrl}
                editable={editable && ["accepted", "in_production", "ready"].includes(o.status)}
                onDone={setMsg}
              />
            )}
          {physical &&
            (courier ||
              (shop.modules.courier &&
                editable &&
                ["accepted", "in_production", "ready"].includes(o.status))) && (
              <CourierCard
                order={o}
                courier={courier}
                editable={
                  shop.modules.courier &&
                  editable &&
                  ["accepted", "in_production", "ready"].includes(o.status)
                }
                onDone={setMsg}
              />
            )}
          {(refunded > 0 || (editable && refundable > 0)) && (
            <RefundCard
              order={o}
              refunded={refunded}
              refundable={editable ? refundable : 0}
              onDone={setMsg}
            />
          )}
          {physical && (
            <PaymentCard
              order={o}
              dueNow={dueNow}
              balanceProofUrl={balancePending ? balanceProofUrl : null}
            />
          )}
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
            {balanceProofUrl && (
              <p className="mt-3 text-sm">
                <a
                  className="text-accent hover:underline"
                  href={balanceProofUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  {t("order.balanceProof")}
                </a>
              </p>
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
          {editable && (
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
          )}
        </div>
      </div>
    </div>
  );
}

type Order = Awaited<ReturnType<typeof orderFn>>["order"];

/** Фото готового заказа на согласование: отправить и увидеть ответ (core/orders/approval). */
function ApprovalCard({
  order: o,
  approval,
  photoUrl,
  editable,
  onDone,
}: {
  order: Order;
  approval: Awaited<ReturnType<typeof orderFn>>["approval"];
  photoUrl: string | null;
  editable: boolean;
  onDone: (msg: string) => void;
}) {
  const { shop } = Route.useRouteContext();
  const t = adminT(shop.locale);
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState("");
  const [open, setOpen] = useState(approval.status === "none");
  const send = useAction(async () => {
    if (!file) return;
    const { uploadFile } = await import("@/app/admin/upload-client");
    const key = await uploadFile("chatPhoto", file, t, (status) =>
      t("approval.uploadFailed", { status }),
    );
    const r = await sendApprovalFn({ data: { id: o.id, key, note: note.trim() || null } });
    onDone(r.message);
    setFile(null);
    setNote("");
    setOpen(false);
    await router.invalidate();
  });
  return (
    <Card title={t("approval.title")}>
      {approval.status !== "none" && (
        <div className="mb-3 space-y-2">
          {photoUrl && (
            <a href={photoUrl} target="_blank" rel="noreferrer">
              <img src={photoUrl} alt="" className="max-h-48 rounded-md border border-line" />
            </a>
          )}
          <Badge
            tone={
              approval.status === "ok" ? "ok" : approval.status === "changes" ? "warn" : "neutral"
            }
          >
            {approval.status === "ok"
              ? t("approval.ok")
              : approval.status === "changes"
                ? t("approval.changes", { text: approval.text })
                : t("approval.waiting")}
          </Badge>
        </div>
      )}
      {editable && !open && (
        <button className="btn-secondary" onClick={() => setOpen(true)}>
          {t("approval.again")}
        </button>
      )}
      {editable && open && (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            void send.run().catch(() => {});
          }}
        >
          <p className="text-xs text-muted">{t("approval.hint")}</p>
          <Field label={t("approval.photo")}>
            <input
              className="input"
              type="file"
              accept="image/jpeg,image/png"
              required
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </Field>
          <Field label={t("approval.note")}>
            <input
              className="input"
              maxLength={500}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>
          <ErrorBox error={send.error} />
          <button className="btn-primary" disabled={send.busy || !file}>
            {send.busy ? t("approval.uploading") : t("approval.send")}
          </button>
        </form>
      )}
    </Card>
  );
}

/** Возврат денег: сколько вернули, форма полного или частичного возврата (core/orders/refund). */
function RefundCard({
  order: o,
  refunded,
  refundable,
  onDone,
}: {
  order: Order;
  refunded: number;
  refundable: number;
  onDone: (msg: string) => void;
}) {
  const { shop } = Route.useRouteContext();
  const t = adminT(shop.locale);
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(String(refundable));
  const [reason, setReason] = useState("");
  const [restock, setRestock] = useState(false);
  const [notify, setNotify] = useState(true);
  const run = useAction(async () => {
    const sum = Number(amount.replace(",", "."));
    if (!confirm(t("refund.confirm", { sum: formatMoney(sum, o.currency), no: displayNo(o) })))
      return;
    const r = await refundOrderFn({
      data: { id: o.id, amount: sum, reason: reason.trim() || null, restock, notify },
    });
    onDone(r.message);
    setOpen(false);
    await router.invalidate();
  });
  return (
    <Card title={t("refund.title")}>
      {refunded > 0 && (
        <p className="mb-2 text-sm">
          {t("refund.done", { sum: formatMoney(refunded, o.currency) })}
        </p>
      )}
      {refundable > 0 && !open && (
        <button className="btn-secondary" onClick={() => setOpen(true)}>
          {t("refund.button")}
        </button>
      )}
      {refundable > 0 && open && (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            void run.run().catch(() => {});
          }}
        >
          <p className="text-xs text-muted">
            {t("refund.available", { sum: formatMoney(refundable, o.currency) })}
          </p>
          <Field label={t("refund.amount")}>
            <div className="flex gap-2">
              <input
                className="input"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
              <button
                type="button"
                className="btn-ghost text-xs"
                onClick={() => setAmount(String(refundable))}
              >
                {t("refund.all")}
              </button>
            </div>
          </Field>
          <Field label={t("refund.reason")}>
            <input
              className="input"
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
          {shop.modules.stock && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={restock}
                onChange={(e) => setRestock(e.target.checked)}
              />
              {t("refund.restock")}
            </label>
          )}
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
            {t("refund.notify")}
          </label>
          <p className="text-xs text-muted">{t("refund.hint")}</p>
          <ErrorBox error={run.error} />
          <div className="flex gap-2">
            <button className="btn-primary" disabled={run.busy}>
              {t("refund.submit")}
            </button>
            <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>
              {t("refund.cancel")}
            </button>
          </div>
        </form>
      )}
    </Card>
  );
}
type Zone = { id: string; name: string; price: number };

/** Внесено / осталось по физическому заказу и ручное внесение оплаты. */
function PaymentCard({
  order: o,
  dueNow,
  balanceProofUrl,
}: {
  order: Order;
  dueNow: number;
  /** Чек на остаток ждёт проверки (core/orders/balance). */
  balanceProofUrl: string | null;
}) {
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
  const rejectBalance = useAction(async () => {
    await rejectBalanceProofFn({ data: { id: o.id } });
    await router.invalidate();
  });
  const closed = o.status === "rejected" || o.status === "cancelled";
  return (
    <Card title={t("physical.payTitle")}>
      {balanceProofUrl && (
        <div className="mb-3 space-y-2 rounded-md bg-surface-2 p-3 text-sm">
          <p>{t("order.balancePendingNote")}</p>
          <a
            className="text-accent hover:underline"
            href={balanceProofUrl}
            target="_blank"
            rel="noreferrer"
          >
            {t("order.balanceProof")}
          </a>
          {canEdit(shop.role) && (
            <div>
              <button
                className="btn-secondary"
                disabled={rejectBalance.busy}
                onClick={() => void rejectBalance.run().catch(() => {})}
              >
                {t("order.balanceReject")}
              </button>
              <ErrorBox error={rejectBalance.error} />
            </div>
          )}
        </div>
      )}
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
      {remaining > 0 && !closed && canEdit(shop.role) && (
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
function FulfillmentEditor({
  order: o,
  zones,
  slots,
  closed,
  fullDays,
}: {
  order: Order;
  zones: Zone[];
  slots: string[];
  closed: ClosedRules;
  fullDays: string[];
}) {
  const { shop } = Route.useRouteContext();
  const t = adminT(shop.locale);
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const currentDate = o.fulfillment_at ? o.fulfillment_at.slice(0, 10) : "";
  const [pickedDate, setPickedDate] = useState(currentDate);
  const [type, setType] = useState<"pickup" | "delivery">(
    o.fulfillment_type === "delivery" ? "delivery" : "pickup",
  );
  const save = useAction(async (form: FormData) => {
    const str = (k: string) => String(form.get(k) ?? "").trim() || null;
    await updateFulfillmentFn({
      data: {
        id: o.id,
        fulfillmentAt: str("at"),
        slot: str("slot"),
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
          defaultValue={currentDate}
          onChange={(e) => setPickedDate(e.target.value)}
        />
        {pickedDate &&
          pickedDate !== currentDate &&
          (isClosedDay(pickedDate, closed) ? (
            <p className="text-xs text-warn">{t("physical.dateClosedWarn")}</p>
          ) : fullDays.includes(pickedDate) ? (
            <p className="text-xs text-warn">{t("physical.dateFullWarn")}</p>
          ) : null)}
      </Field>
      {slots.length > 0 && (
        <Field label={t("physical.slot")}>
          <select
            className="input"
            name="slot"
            defaultValue={slots.find((x) => x === slotOf(o.fulfillment_at, slots)) ?? ""}
          >
            <option value="">{t("physical.slotNone")}</option>
            {slots.map((x) => (
              <option key={x} value={x}>
                {x}
              </option>
            ))}
          </select>
        </Field>
      )}
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

const COURIER_PROVIDERS = ["yandex", "indrive", "own", "other"] as const;

/** Передача заказа курьеру со ссылкой на отслеживание (core/fulfillment/courier). */
function CourierCard({
  order: o,
  courier,
  editable,
  onDone,
}: {
  order: Order;
  courier: Awaited<ReturnType<typeof orderFn>>["courier"];
  editable: boolean;
  onDone: (msg: string) => void;
}) {
  const { shop } = Route.useRouteContext();
  const t = adminT(shop.locale);
  const router = useRouter();
  const [open, setOpen] = useState(!courier);
  const send = useAction(async (f: FormData) => {
    const provider = String(f.get("provider")) as (typeof COURIER_PROVIDERS)[number];
    const r = await dispatchCourierFn({
      data: {
        id: o.id,
        provider,
        trackUrl: String(f.get("trackUrl") ?? "").trim() || null,
        phone: String(f.get("phone") ?? "").trim() || null,
      },
    });
    onDone(r.message);
    setOpen(false);
    await router.invalidate();
  });
  return (
    <Card title={t("courier.title")}>
      {courier && (
        <div className="mb-3 space-y-1 text-sm">
          <Badge tone="neutral">
            {t("courier.current", { provider: t(`courier.provider.${courier.provider}`) })}
          </Badge>
          {courier.trackUrl && (
            <div>
              <a
                className="text-accent underline"
                href={courier.trackUrl}
                target="_blank"
                rel="noreferrer"
              >
                {t("courier.track")}
              </a>
            </div>
          )}
          {courier.phone && <div className="text-muted">{courier.phone}</div>}
        </div>
      )}
      {editable && !open && (
        <button className="btn-secondary" onClick={() => setOpen(true)}>
          {t("courier.again")}
        </button>
      )}
      {editable && open && (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            void send.run(new FormData(e.currentTarget)).catch(() => {});
          }}
        >
          <p className="text-xs text-muted">{t("courier.hint")}</p>
          <Field label={t("courier.provider")}>
            <select className="input" name="provider" defaultValue={courier?.provider ?? "yandex"}>
              {COURIER_PROVIDERS.map((p) => (
                <option key={p} value={p}>
                  {t(`courier.provider.${p}`)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("courier.trackUrl")}>
            <input className="input" name="trackUrl" type="url" maxLength={500} />
          </Field>
          <Field label={t("courier.phone")}>
            <input className="input" name="phone" type="tel" maxLength={40} />
          </Field>
          <ErrorBox error={send.error} />
          <button className="btn-primary" disabled={send.busy}>
            {t("courier.send")}
          </button>
        </form>
      )}
    </Card>
  );
}
