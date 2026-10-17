import { HelpTip } from "@/app/admin/help-panel";
import { canEdit } from "@/core/auth/roles";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { orderActionFn, orderFn, orderNoteFn, orderTrackingFn } from "@/app/admin/orders.functions";
import { adminT, intlLocale, type AdminKey } from "@/app/i18n/admin";
import { Badge, Card, ErrorBox, Field, useAction } from "@/app/ui";
import { describeOrderEvent } from "@/core/orders/events";
import { formatMoney } from "@/core/money/money";
import { displayNo, itemLanguages } from "@/core/orders/pure";
import { orderBlocks } from "@/core/orders/blocks";
import { orderMoney } from "@/core/orders/money";
import { mainAction, moreActions, orderSteps } from "@/core/orders/steps";
import { closedHandover, defaultHandoverStep } from "@/core/orders/handover";
import { slotOf } from "@/core/fulfillment/slots";
import { ApprovalCard, CourierCard, FulfillmentEditor } from "@/app/admin/order-cards";
import { MoneyBlock } from "@/app/admin/order-money";
import { OrderStatus } from "./admin._authed.orders";

export const Route = createFileRoute("/admin/_authed/orders/$id")({
  loader: ({ params }) => orderFn({ data: { id: Number(params.id) } }),
  component: OrderPage,
});

function OrderPage() {
  const {
    order: o,
    origin,
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
    itemPhotos,
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
  const track = useAction(async (text: string) => {
    const r = await orderTrackingFn({ data: { id: o.id, text } });
    setMsg(r.message);
    await router.invalidate();
  });
  const no = displayNo(o);
  const physical = o.fulfillment_kind === "physical";
  const main = mainAction(o, editable);
  const more = moreActions(o, editable);
  const stepView = orderSteps(o);
  // Последний шаг: у доставки «Отправлен», у самовывоза «Выдан»; закрытый заказ — как закрыт (старые — «Выдан»).
  const lastStep = !physical
    ? "done"
    : o.status === "delivered"
      ? closedHandover(events)
      : defaultHandoverStep(o.fulfillment_type);
  const blocks = orderBlocks({
    status: o.status,
    fulfillment_kind: o.fulfillment_kind,
    editable,
    courierModule: Boolean(shop.modules.courier),
    hasGift: Boolean(gift),
    approvalStatus: approval.status,
    hasCourier: Boolean(courier),
  });
  const money = orderMoney({ order: o, events, dueNow, refunded, refundable });
  const run = (a: "confirm" | "next" | "prev" | "remind" | "reject") =>
    void act.run(a).catch(() => {});
  return (
    <div
      className="space-y-4 lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto"
      data-testid="order-detail"
    >
      <div className="card p-4 lg:sticky lg:top-0 lg:z-10">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <Link
              to="/admin/orders"
              search={true}
              className="mb-1 inline-block text-xs text-accent hover:underline lg:hidden"
            >
              {t("orders.backToList")}
            </Link>
            <h2 className="flex flex-wrap items-center gap-2 text-lg font-semibold">
              {t("order.title", { no })} <OrderStatus status={o.status} />
            </h2>
            <p className="text-sm text-muted">
              {new Date(o.created_at).toLocaleString(intlLocale(shop.locale))} ·{" "}
              {o.platform === "web" ? t("order.platformWeb") : o.platform} ·{" "}
              {physical ? t("order.physical") : t("order.digital")}
            </p>
            {origin && (
              <div className="mt-2 flex flex-wrap items-center gap-2" data-testid="order-origin">
                <span
                  className="inline-flex items-center gap-1.5 rounded-md border border-accent/25 bg-accent/10 px-2.5 py-1 text-xs font-medium text-accent"
                  title={origin.explanation ?? origin.label}
                >
                  <span className="opacity-75">📍 {t("order.origin")}:</span>
                  <span className="font-semibold">{origin.label}</span>
                </span>
                {origin.explanation && (
                  <span className="text-xs text-muted max-sm:hidden" title={t("order.origin.why")}>
                    ({origin.explanation})
                  </span>
                )}
              </div>
            )}
          </div>
          <Link
            to="/admin/orders"
            search={true}
            className="btn-ghost max-lg:hidden"
            aria-label={t("common.close")}
          >
            ✕
          </Link>
        </div>
        {!stepView.closed && (
          <ol
            aria-label={t("order.stepsLabel")}
            className="mb-3 flex flex-wrap gap-x-1 gap-y-1 text-xs"
            data-testid="order-steps"
          >
            {stepView.steps.map((s, i) => (
              <li
                key={s.key}
                aria-current={s.state === "current" ? "step" : undefined}
                data-state={s.state}
                className={`flex items-center gap-1 rounded-full border px-2 py-0.5 ${
                  s.state === "current"
                    ? "border-accent bg-accent/10 font-medium text-accent"
                    : s.state === "done"
                      ? "border-ok/30 bg-ok/10 text-ok"
                      : "border-line text-muted"
                }`}
              >
                <span aria-hidden="true">{s.state === "done" ? "✓" : i + 1}</span>
                {t(`order.step.${s.key === "done" ? lastStep : s.key}` as AdminKey)}
              </li>
            ))}
          </ol>
        )}
        {/* Бухгалтер и «просмотр» ничего не меняют: кнопок нет, сервер всё равно откажет. */}
        <div className={editable ? "flex flex-wrap items-center gap-2" : "hidden"}>
          {main && (
            <button
              className="btn-primary"
              disabled={act.busy}
              data-testid="order-main-action"
              onClick={() => run(main.action)}
            >
              {t(main.label)}
            </button>
          )}
          {main && (
            <HelpTip
              article="orders"
              anchor={
                main.action === "next"
                  ? "next-step"
                  : physical
                    ? "accept-physical"
                    : "confirm-deliver"
              }
            />
          )}
          <details className="relative">
            <summary
              className="btn-secondary cursor-pointer list-none"
              aria-label={t("order.moreLabel")}
            >
              {t("order.more")}
            </summary>
            <div className="absolute left-0 z-10 mt-1 flex w-56 flex-col gap-1 rounded-md border border-line bg-surface p-2 shadow-md">
              {more.includes("prev") && (
                <button
                  className="btn-ghost justify-start"
                  disabled={act.busy}
                  onClick={() => run("prev")}
                >
                  {t("order.stepBack")}
                </button>
              )}
              {more.includes("remind") && (
                <button
                  className="btn-ghost justify-start"
                  disabled={act.busy}
                  onClick={() => run("remind")}
                >
                  {t("order.remind")}
                </button>
              )}
              {gift && shop.role !== "accountant" && (
                <a
                  href={`/admin/packing/${o.id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="btn-ghost justify-start"
                >
                  {t("packing.print")}
                </a>
              )}
              {physical && (
                <a
                  href={`/admin/print/${o.id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="btn-ghost justify-start"
                >
                  {t("print.button")}
                </a>
              )}
              {pageUrl && (
                <button
                  className="btn-ghost justify-start"
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
              {more.includes("reject") && (
                <button
                  className="btn-ghost justify-start text-danger"
                  disabled={act.busy}
                  onClick={() => run("reject")}
                >
                  {t("order.reject")}
                </button>
              )}
            </div>
          </details>
        </div>
        {msg && <p className="mt-2 text-sm text-muted">{msg}</p>}
        <ErrorBox error={act.error} />
      </div>

      <div className="space-y-4 xl:grid xl:grid-cols-[minmax(0,1fr)_280px] xl:items-start xl:gap-4 xl:space-y-0">
        <div className="space-y-4">
          <MoneyBlock
            order={o}
            money={money}
            proofUrl={proofUrl}
            balanceProofUrl={balanceProofUrl}
            balancePending={balancePending}
            dueNow={dueNow}
            refunded={refunded}
            refundable={refundable}
            editable={editable}
            onDone={setMsg}
          />
          <Card title={t("order.items")} help={<HelpTip article="orders" anchor="items" />}>
            <table className="table">
              <tbody>
                {(o.order_items ?? []).map((i) => (
                  <tr key={i.id}>
                    <td>
                      <div className="flex items-center gap-2">
                        {i.product_id && itemPhotos[i.product_id] && (
                          <img
                            src={itemPhotos[i.product_id]}
                            alt=""
                            loading="lazy"
                            className="h-10 w-10 shrink-0 rounded-md border border-line object-cover"
                          />
                        )}
                        <div>
                          {i.name_snapshot}
                          <div className="text-xs text-muted">
                            {t("order.files", {
                              langs: itemLanguages(i).join(", ") || t("order.noFiles"),
                            })}
                          </div>
                        </div>
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
          {blocks.gift && gift && (
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
          {blocks.approval.show && (
            <ApprovalCard
              order={o}
              approval={approval}
              photoUrl={approvalPhotoUrl}
              editable={blocks.approval.editable}
              onDone={setMsg}
            />
          )}
          {blocks.courier.show && (
            <CourierCard
              order={o}
              courier={courier}
              editable={blocks.courier.editable}
              onDone={setMsg}
            />
          )}
          <Card title={t("order.history")} help={<HelpTip article="orders" anchor="history" />}>
            {events.length === 0 ? (
              <p className="text-sm text-muted">{t("order.noEvents")}</p>
            ) : (
              <ol className="space-y-1.5 text-sm" data-testid="order-history">
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
        </div>
        <div className="space-y-4">
          <Card title={t("order.customer")} help={<HelpTip article="orders" anchor="customer" />}>
            <dl className="grid grid-cols-[96px_1fr] gap-y-1 text-sm">
              <dt className="text-muted">{t("order.name")}</dt>
              <dd className="min-w-0 break-words">
                {o.display_name} {o.username && <span className="text-muted">@{o.username}</span>}
              </dd>
              <dt className="text-muted">{t("order.phone")}</dt>
              <dd className="min-w-0 break-words">{o.contact ?? "—"}</dd>
              <dt className="text-muted">{t("order.email")}</dt>
              <dd className="min-w-0 break-words">{o.customer_email ?? "—"}</dd>
              <dt className="text-muted">{t("order.country")}</dt>
              <dd>{o.country_name ?? "—"}</dd>
              {physical && (
                <>
                  <dt className="text-muted">{t("order.fulfillment")}</dt>
                  <dd className="min-w-0 break-words">
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
            {blocks.fulfillmentEditor && (
              <FulfillmentEditor
                order={o}
                zones={zones}
                slots={slots}
                closed={{ weekdays: closedWeekdays, ranges: closedRanges }}
                fullDays={fullDays}
              />
            )}
          </Card>
          {editable &&
            physical &&
            o.fulfillment_type !== "pickup" &&
            (o.status === "ready" || o.status === "delivered") && (
              <Card
                title={t("order.track.title")}
                help={<HelpTip article="orders" anchor="track" />}
              >
                <form
                  className="space-y-2"
                  data-testid="order-track-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const text = String(new FormData(e.currentTarget).get("track") ?? "");
                    void track.run(text).catch(() => {});
                  }}
                >
                  <Field label={t("order.track.hint")}>
                    <input
                      className="input"
                      name="track"
                      maxLength={300}
                      required
                      placeholder={t("order.track.placeholder")}
                    />
                  </Field>
                  <button className="btn-secondary" disabled={track.busy}>
                    {t("order.track.send")}
                  </button>
                </form>
              </Card>
            )}
          {blocks.note && (
            <Card title={t("order.note")} help={<HelpTip article="orders" anchor="note" />}>
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
