import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { orderActionFn, orderFn, orderNoteFn } from "@/app/admin/admin.functions";
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
  const { order: o, proofUrl, events } = Route.useLoaderData();
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  const act = useAction(async (action: "confirm" | "reject" | "next" | "prev" | "remind") => {
    if (action === "reject" && !confirm("Отклонить заказ? Покупатель получит уведомление.")) return;
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
              Заказ #{no} <OrderStatus status={o.status} />
            </h2>
            <p className="text-sm text-muted">
              {new Date(o.created_at).toLocaleString("ru")} · {o.platform} ·{" "}
              {physical ? "физический" : "цифровой"}
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
              {physical ? "✅ Принять заказ" : "✅ Подтвердить и выдать"}
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
                  ? "→ В производство"
                  : o.status === "in_production"
                    ? "→ Готов"
                    : "→ Выдан"}
              </button>
            )}
          {physical && (o.status === "in_production" || o.status === "ready") && (
            <button
              className="btn-ghost"
              disabled={act.busy}
              onClick={() => void act.run("prev").catch(() => {})}
            >
              ← Шаг назад
            </button>
          )}
          {o.status === "awaiting_payment" && (
            <button
              className="btn-secondary"
              disabled={act.busy}
              onClick={() => void act.run("remind").catch(() => {})}
            >
              ⏰ Напомнить об оплате
            </button>
          )}
          {canReject && (
            <button
              className="btn-ghost text-danger"
              disabled={act.busy}
              onClick={() => void act.run("reject").catch(() => {})}
            >
              Отклонить
            </button>
          )}
        </div>
        {msg && <p className="mb-3 text-sm text-muted">{msg}</p>}
        <ErrorBox error={act.error} />

        <div className="space-y-4">
          <Card title="Покупатель">
            <dl className="grid grid-cols-[120px_1fr] gap-y-1 text-sm">
              <dt className="text-muted">Имя</dt>
              <dd>
                {o.display_name} {o.username && <span className="text-muted">@{o.username}</span>}
              </dd>
              <dt className="text-muted">Телефон</dt>
              <dd>{o.contact ?? "—"}</dd>
              <dt className="text-muted">Почта</dt>
              <dd>{o.customer_email ?? "—"}</dd>
              <dt className="text-muted">Страна</dt>
              <dd>{o.country_name ?? "—"}</dd>
              {physical && (
                <>
                  <dt className="text-muted">Получение</dt>
                  <dd>
                    {o.fulfillment_type === "delivery" ? "🚚 Доставка" : "🏠 Самовывоз"}{" "}
                    {o.fulfillment_at ? new Date(o.fulfillment_at).toLocaleDateString("ru") : ""}
                    {o.fulfillment_address && <div>{o.fulfillment_address}</div>}
                    {o.fulfillment_note && <div className="text-muted">{o.fulfillment_note}</div>}
                  </dd>
                </>
              )}
            </dl>
          </Card>
          <Card title="Состав">
            <table className="table">
              <tbody>
                {(o.order_items ?? []).map((i) => (
                  <tr key={i.id}>
                    <td>
                      {i.name_snapshot}
                      <div className="text-xs text-muted">
                        файлы: {itemLanguages(i).join(", ") || "нет"}
                      </div>
                    </td>
                    <td className="text-right whitespace-nowrap tabular-nums">
                      {i.quantity} × {formatMoney(i.price_snapshot, o.currency)}
                    </td>
                  </tr>
                ))}
                <tr>
                  <td className="font-medium">Итого</td>
                  <td className="text-right font-medium tabular-nums">
                    {formatMoney(o.total, o.currency)}
                  </td>
                </tr>
              </tbody>
            </table>
            {Number(o.discount_amount) > 0 && (
              <p className="mt-1 text-xs text-muted">
                Скидка: {formatMoney(o.discount_amount, o.currency)}
              </p>
            )}
          </Card>
          <Card title="Чек оплаты">
            {proofUrl ? (
              /\.(pdf)(\?|$)/i.test(o.payment_proof_path ?? "") ? (
                <a
                  className="text-accent hover:underline"
                  href={proofUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Открыть PDF
                </a>
              ) : (
                <a href={proofUrl} target="_blank" rel="noreferrer">
                  <img
                    src={proofUrl}
                    alt="чек"
                    className="max-h-96 rounded-md border border-line"
                  />
                </a>
              )
            ) : (
              <p className="text-sm text-muted">Чек ещё не прислан.</p>
            )}
          </Card>
          <Card title="История">
            {events.length === 0 ? (
              <p className="text-sm text-muted">Событий пока нет.</p>
            ) : (
              <ol className="space-y-1.5 text-sm">
                {events.map((e) => {
                  const d = describeOrderEvent(e);
                  return (
                    <li key={e.id} className="flex items-start gap-2">
                      <span className="w-28 shrink-0 text-xs text-muted tabular-nums">
                        {new Date(e.at).toLocaleString("ru", {
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
          <Card title="Заметка">
            <form
              className="space-y-2"
              onSubmit={(e) => {
                e.preventDefault();
                void note.run(String(new FormData(e.currentTarget).get("note"))).catch(() => {});
              }}
            >
              <Field label="Видна только вам">
                <textarea
                  className="input"
                  name="note"
                  rows={2}
                  defaultValue={o.admin_note ?? ""}
                />
              </Field>
              <button className="btn-secondary" disabled={note.busy}>
                Сохранить
              </button>
            </form>
          </Card>
        </div>
      </div>
    </div>
  );
}
