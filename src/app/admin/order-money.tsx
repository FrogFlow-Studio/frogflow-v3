import { HelpTip } from "@/app/admin/help-panel";
import { useRouteContext } from "@tanstack/react-router";
import { adminT, intlLocale } from "@/app/i18n/admin";
import { Badge, Card } from "@/app/ui";
import { formatMoney } from "@/core/money/money";
import { orderMoney, type MoneyFlag, type MoneyRow } from "@/core/orders/money";
import { PaymentCard, RefundCard, type Order } from "./order-cards";

type Money = ReturnType<typeof orderMoney>;

const FLAG_TONE: Record<MoneyFlag, "danger" | "warn"> = {
  closed: "danger",
  mismatch: "danger",
  overpaid: "warn",
};

/** Блок «Деньги» карточки заказа (З3): сумма, способ, чек со сверкой, переплата, возвраты, журнал. */
export function MoneyBlock({
  order: o,
  money,
  proofUrl,
  balanceProofUrl,
  balancePending,
  dueNow,
  refunded,
  refundable,
  editable,
  onDone,
}: {
  order: Order;
  money: Money;
  proofUrl: string | null;
  balanceProofUrl: string | null;
  /** Чек на остаток ждёт проверки продавцом (из загрузки заказа). */
  balancePending: boolean;
  dueNow: number;
  refunded: number;
  refundable: number;
  editable: boolean;
  onDone: (msg: string) => void;
}) {
  const { shop } = useRouteContext({ from: "/admin/_authed" });
  const t = adminT(shop.locale);
  const methodLabel = (m: string) =>
    m === "receipt" ? t("money.method.receipt") : m === "manual" ? t("money.method.manual") : m;
  const fmt = (n: number, cur = o.currency) => formatMoney(n, cur);
  const physical = o.fulfillment_kind === "physical";
  const when = (at: string) =>
    new Date(at).toLocaleString(intlLocale(shop.locale), {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  const rowLabel = (r: MoneyRow) => t(`money.kind.${r.kind}` as Parameters<typeof t>[0]);
  return (
    <Card title={t("money.title")} help={<HelpTip article="orders" anchor="money" />}>
      <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 text-sm">
        <dt className="text-muted">{t("money.total")}</dt>
        <dd className="text-right font-medium tabular-nums" data-testid="money-total">
          {fmt(money.total)}
        </dd>
        {money.discount > 0 && (
          <>
            <dt className="text-muted">{t("money.discount")}</dt>
            <dd className="text-right tabular-nums">−{fmt(money.discount)}</dd>
          </>
        )}
        <dt className="text-muted">{t("money.method")}</dt>
        <dd className="text-right">
          {money.method ? methodLabel(money.method) : t("money.methodNone")}
        </dd>
        <dt className="text-muted">{t("money.received")}</dt>
        <dd className="text-right tabular-nums" data-testid="money-received">
          {fmt(money.received)}
        </dd>
        {money.remaining > 0 && (
          <>
            <dt className="text-muted">{t("money.remaining")}</dt>
            <dd className="text-right tabular-nums" data-testid="money-remaining">
              {fmt(money.remaining)}
            </dd>
          </>
        )}
        {money.refunded > 0 && (
          <>
            <dt className="text-muted">{t("money.refunded")}</dt>
            <dd className="text-right tabular-nums">{fmt(money.refunded)}</dd>
          </>
        )}
      </dl>
      {money.overpaid > 0 && (
        <p className="mt-2">
          <Badge tone="warn">{t("money.overpaid", { sum: fmt(money.overpaid) })}</Badge>
        </p>
      )}
      {money.flags.length > 0 && (
        <ul className="mt-2 space-y-1 text-xs" data-testid="money-flags">
          {money.flags.map((f) => (
            <li key={f} className={f === "overpaid" ? "text-warn" : "text-danger"}>
              {t(`money.flag.${f}` as Parameters<typeof t>[0])}
            </li>
          ))}
        </ul>
      )}
      {money.proof.pending && money.proof.amount !== null && (
        <p className="mt-3 text-sm" data-testid="money-proof-check">
          {t("money.proofCheck", {
            amount: fmt(money.proof.amount),
            expected: fmt(money.proof.expected),
          })}{" "}
          <Badge tone={money.proof.matches ? "ok" : "warn"}>
            {money.proof.matches ? t("money.proofMatch") : t("money.proofDiff")}
          </Badge>
        </p>
      )}
      <div className="mt-3 border-t border-line pt-3">
        <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-muted">
          {t("money.journal")}
          <HelpTip article="orders" anchor="money-journal" />
        </h3>
        {money.rows.length === 0 ? (
          <p className="text-sm text-muted">{t("money.journalEmpty")}</p>
        ) : (
          <ol className="space-y-1.5 text-sm" data-testid="money-journal">
            {money.rows.map((r) => (
              <li
                key={r.id}
                className={`flex items-start justify-between gap-3 rounded-md px-2 py-1 ${
                  r.flag ? (FLAG_TONE[r.flag] === "danger" ? "bg-danger/10" : "bg-warn/15") : ""
                }`}
              >
                <span className="min-w-0">
                  <span className="text-xs text-muted tabular-nums">{when(r.at)}</span>{" "}
                  <span>{rowLabel(r)}</span>
                  {r.method && <span className="text-muted"> · {methodLabel(r.method)}</span>}
                  {r.ref && (
                    <span className="text-muted">
                      {" · "}
                      {t("money.ref", { ref: r.ref })}
                    </span>
                  )}
                  {r.kind === "refund" && r.paymentRef && (
                    <span className="text-muted">
                      {" · "}
                      {t("money.refundOf", { ref: r.paymentRef })}
                    </span>
                  )}
                  {r.kind === "refund" && r.reason && (
                    <span className="text-muted"> · {r.reason}</span>
                  )}
                  {r.overpaid > 0 && (
                    <span className="text-warn">
                      {" · "}
                      {t("money.overpaid", { sum: fmt(r.overpaid, r.currency ?? o.currency) })}
                    </span>
                  )}
                </span>
                <span className="shrink-0 tabular-nums">
                  {r.kind === "refund" ? "−" : ""}
                  {fmt(r.amount, r.currency ?? o.currency)}
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>
      <div className="mt-3 border-t border-line pt-3 text-sm">
        <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-muted">
          {t("order.proof")}
          <HelpTip article="orders" anchor="proof" />
        </h3>
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
                className="max-h-64 rounded-md border border-line"
              />
            </a>
          )
        ) : (
          <p className="text-muted">{t("order.noProof")}</p>
        )}
        {balanceProofUrl && (
          <p className="mt-2">
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
      </div>
      {(physical || refunded > 0 || (editable && refundable > 0)) && (
        <div className="mt-4 space-y-4">
          {physical && (
            <PaymentCard
              order={o}
              dueNow={dueNow}
              balanceProofUrl={balancePending ? balanceProofUrl : null}
            />
          )}
          {(refunded > 0 || (editable && refundable > 0)) && (
            <RefundCard
              order={o}
              refunded={refunded}
              refundable={editable ? refundable : 0}
              onDone={onDone}
            />
          )}
        </div>
      )}
    </Card>
  );
}
