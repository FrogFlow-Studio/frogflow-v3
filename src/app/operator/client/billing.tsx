/** Карточка клиента у оператора: подписка на платформу, счета и платежи. */
import { useEffect, useState, type FormEvent } from "react";
import {
  addPaymentFn,
  billingFn,
  createInvoiceFn,
  invoiceActionFn,
  invoiceProofUrlFn,
  setOverduePolicyFn,
} from "@/app/operator/operator.functions";
import { Badge, Card, ErrorBox, useAction } from "@/app/ui";
import type { C } from "./types";

type Billing = Awaited<ReturnType<typeof billingFn>>;

const INVOICE_STATUS: Record<
  string,
  { label: string; tone: "ok" | "warn" | "neutral" | "danger" }
> = {
  sent: { label: "выставлен", tone: "neutral" },
  proof_uploaded: { label: "чек прислан", tone: "warn" },
  paid: { label: "оплачен", tone: "ok" },
  rejected: { label: "отклонён", tone: "danger" },
  cancelled: { label: "отменён", tone: "neutral" },
};

const today = () => new Date().toISOString().slice(0, 10);
const plusDays = (iso: string, d: number) => {
  const x = new Date(iso);
  x.setDate(x.getDate() + d);
  return x.toISOString().slice(0, 10);
};

export function BillingCard({ c }: { c: C }) {
  const [data, setData] = useState<Billing | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const load = useAction(async () => setData(await billingFn({ data: { botId: c.id } })));
  useEffect(() => {
    void load.run().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c.id]);
  const invoice = useAction(async (f: FormData) => {
    const r = await createInvoiceFn({
      data: {
        botId: c.id,
        amount: Number(f.get("amount")),
        currency: String(f.get("currency") || "KZT"),
        note: String(f.get("note") || "") || null,
      },
    });
    setNote(
      r.delivered
        ? "Счёт выставлен и отправлен владельцу в его боте."
        : `Счёт выставлен, но не доставлен: ${r.deliveryError ?? "владелец не получил сообщение"}.`,
    );
    await load.run();
  });
  const payment = useAction(async (f: FormData) => {
    const r = await addPaymentFn({
      data: {
        botId: c.id,
        period_start: String(f.get("period_start")),
        period_end: String(f.get("period_end")),
        amount: Number(f.get("amount")),
        currency: String(f.get("currency") || "KZT"),
        note: String(f.get("note") || "") || null,
      },
    });
    setNote(
      `Платёж записан, подписка до ${r.expiresAt ? new Date(r.expiresAt).toLocaleDateString("ru") : "—"}.`,
    );
    await load.run();
  });
  const act = useAction(
    async (p: {
      id: string;
      action: "confirm" | "reject" | "cancel";
      periodStart?: string;
      periodEnd?: string;
      reason?: string;
    }) => {
      const r = await invoiceActionFn({ data: p });
      setNote(r.message);
      await load.run();
    },
  );
  const proof = useAction(async (id: string) => {
    const r = await invoiceProofUrlFn({ data: { id } });
    if (r.url) window.open(r.url, "_blank", "noopener");
  });
  const policy = useAction(async (f: FormData) => {
    await setOverduePolicyFn({
      data: {
        botId: c.id,
        on_overdue: String(f.get("on_overdue")) === "suspend" ? "suspend" : "warn",
        warn_days_before: Number(f.get("warn_days_before")),
        grace_days: Number(f.get("grace_days")),
      },
    });
    setNote("Политика сохранена.");
  });
  const confirm = (id: string) => {
    const start = prompt(
      "Начало оплаченного периода (ГГГГ-ММ-ДД):",
      data?.suggested.start ?? today(),
    );
    if (!start) return;
    const end = prompt(
      "Конец периода (ГГГГ-ММ-ДД):",
      start === data?.suggested.start ? data.suggested.end : plusDays(start, 30),
    );
    if (!end) return;
    void act.run({ id, action: "confirm", periodStart: start, periodEnd: end }).catch(() => {});
  };
  const reject = (id: string) => {
    const reason = prompt("Причина отказа:", "") ?? "";
    void act.run({ id, action: "reject", reason }).catch(() => {});
  };
  const expires = data?.expiresAt ?? c.subscriptionExpiresAt;
  const overdue = expires ? new Date(expires).getTime() < Date.now() : false;
  return (
    <Card
      title="Подписка и счета"
      actions={
        expires ? (
          <Badge tone={overdue ? "danger" : "ok"}>
            {overdue ? "просрочена с" : data && !data.backedByPayments ? "срок до" : "оплачена до"}{" "}
            {new Date(expires).toLocaleDateString("ru")}
          </Badge>
        ) : (
          <Badge>платежей нет</Badge>
        )
      }
    >
      {!data ? (
        <p className="text-sm text-muted">Загрузка…</p>
      ) : (
        <div className="space-y-4">
          {!data.backedByPayments && (
            <p className="rounded-md border border-line p-2 text-sm text-warn">
              Дата не подтверждена ни одним платежом — досталась от заведения клиента. При первом же
              записанном платеже она пересчитается по нему.
            </p>
          )}
          <form
            className="grid gap-2 sm:grid-cols-3"
            onSubmit={(e: FormEvent<HTMLFormElement>) => {
              e.preventDefault();
              const form = e.currentTarget;
              void invoice
                .run(new FormData(form))
                .then(() => form.reset())
                .catch(() => {});
            }}
          >
            <div className="text-sm font-medium sm:col-span-3">Выставить счёт владельцу</div>
            <input
              className="input"
              name="amount"
              type="number"
              min={1}
              step="0.01"
              placeholder="Сумма"
              required
            />
            <input className="input" name="currency" defaultValue="KZT" maxLength={8} />
            <input className="input" name="note" placeholder="За что (необязательно)" />
            <div className="sm:col-span-3">
              <button className="btn-primary" disabled={invoice.busy || !data.requisites}>
                Выставить
              </button>
              {!data.requisites && (
                <span className="ml-2 text-xs text-warn">
                  Сначала заполните реквизиты в настройках платформы.
                </span>
              )}
            </div>
          </form>
          {data.invoices.length > 0 && (
            <table className="table">
              <thead>
                <tr>
                  <th>Счёт</th>
                  <th>Статус</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {data.invoices.map((i) => {
                  const st = INVOICE_STATUS[i.status] ?? {
                    label: i.status,
                    tone: "neutral" as const,
                  };
                  return (
                    <tr key={i.id}>
                      <td>
                        <span className="font-medium">
                          {i.amount} {i.currency}
                        </span>
                        {i.note && <span className="block text-xs text-muted">{i.note}</span>}
                        <span className="block text-xs text-muted">
                          {new Date(i.created_at).toLocaleDateString("ru")}
                        </span>
                      </td>
                      <td>
                        <Badge tone={st.tone}>{st.label}</Badge>
                        {i.reject_reason && (
                          <span className="block text-xs text-muted">{i.reject_reason}</span>
                        )}
                      </td>
                      <td className="text-right whitespace-nowrap">
                        {i.has_proof && (
                          <button
                            type="button"
                            className="btn-ghost text-xs"
                            onClick={() => void proof.run(i.id).catch(() => {})}
                          >
                            Чек
                          </button>
                        )}
                        {(i.status === "sent" || i.status === "proof_uploaded") && (
                          <>
                            <button
                              type="button"
                              className="btn-primary text-xs"
                              disabled={act.busy}
                              onClick={() => confirm(i.id)}
                            >
                              Оплачен
                            </button>{" "}
                            <button
                              type="button"
                              className="btn-ghost text-xs"
                              disabled={act.busy}
                              onClick={() => reject(i.id)}
                            >
                              Отклонить
                            </button>
                          </>
                        )}
                        {i.status === "sent" && (
                          <button
                            type="button"
                            className="btn-ghost text-xs"
                            disabled={act.busy}
                            onClick={() =>
                              void act.run({ id: i.id, action: "cancel" }).catch(() => {})
                            }
                          >
                            Отменить
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <form
            className="grid gap-2 sm:grid-cols-3"
            onSubmit={(e: FormEvent<HTMLFormElement>) => {
              e.preventDefault();
              const form = e.currentTarget;
              void payment
                .run(new FormData(form))
                .then(() => form.reset())
                .catch(() => {});
            }}
          >
            <div className="text-sm font-medium sm:col-span-3">Записать платёж без счёта</div>
            <input
              className="input"
              name="period_start"
              type="date"
              defaultValue={today()}
              required
            />
            <input
              className="input"
              name="period_end"
              type="date"
              defaultValue={plusDays(today(), 30)}
              required
            />
            <input
              className="input"
              name="amount"
              type="number"
              min={0}
              step="0.01"
              placeholder="Сумма"
              required
            />
            <input className="input" name="currency" defaultValue="KZT" maxLength={8} />
            <input className="input sm:col-span-2" name="note" placeholder="Примечание" />
            <div className="sm:col-span-3">
              <button className="btn-secondary" disabled={payment.busy}>
                Записать
              </button>
            </div>
          </form>
          {data.payments.length > 0 && (
            <ul className="divide-y divide-line text-sm">
              {data.payments.slice(0, 10).map((p) => (
                <li key={p.id} className="flex items-center justify-between py-1.5">
                  <span>
                    {new Date(p.period_start).toLocaleDateString("ru")} –{" "}
                    {new Date(p.period_end).toLocaleDateString("ru")}
                    {p.note && <span className="text-muted"> · {p.note}</span>}
                  </span>
                  <span className="tabular-nums">
                    {p.amount} {p.currency}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <form
            className="grid gap-2 sm:grid-cols-3"
            onSubmit={(e: FormEvent<HTMLFormElement>) => {
              e.preventDefault();
              void policy.run(new FormData(e.currentTarget)).catch(() => {});
            }}
          >
            <div className="text-sm font-medium sm:col-span-3">При неоплате</div>
            <select
              className="input"
              name="on_overdue"
              defaultValue={c.subscription.policy.on_overdue}
            >
              <option value="warn">только предупреждать</option>
              <option value="suspend">приостановить после отсрочки</option>
            </select>
            <input
              className="input"
              name="warn_days_before"
              type="number"
              min={0}
              max={60}
              defaultValue={c.subscription.policy.warn_days_before}
              title="За сколько дней предупреждать"
            />
            <input
              className="input"
              name="grace_days"
              type="number"
              min={0}
              max={60}
              defaultValue={c.subscription.policy.grace_days}
              title="Дней отсрочки после истечения"
            />
            <div className="text-xs text-muted sm:col-span-3">
              Предупреждение за N дней до конца и отсрочка после истечения; обход — ежедневно,
              владелец получает сообщение от своего бота.
            </div>
            <div className="sm:col-span-3">
              <button className="btn-secondary" disabled={policy.busy}>
                Сохранить политику
              </button>
            </div>
          </form>
          {note && <p className="text-sm text-muted">{note}</p>}
          <ErrorBox
            error={
              load.error ??
              invoice.error ??
              payment.error ??
              act.error ??
              proof.error ??
              policy.error
            }
          />
        </div>
      )}
    </Card>
  );
}
