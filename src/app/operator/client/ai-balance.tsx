/** Карточка клиента у оператора: ИИ-баланс — остаток, журнал, ручная поправка. */
import { type FormEvent } from "react";
import { adjustAiBalanceFn, type getClientFn } from "@/app/operator/operator.functions";
import { Badge, Card, ErrorBox, Field, useAction } from "@/app/ui";
import type { C } from "./types";

type AI = Awaited<ReturnType<typeof getClientFn>>["ai"];

const KIND: Record<string, string> = {
  start: "Стартовый лимит",
  topup: "Пополнение",
  adjust: "Поправка оператора",
};

const money = (usd: number) => `${usd < 0 ? "−" : ""}$${Math.abs(usd).toFixed(usd % 1 ? 4 : 2)}`;

export function AiBalanceCard({ c, ai, onDone }: { c: C; ai: AI; onDone: () => Promise<void> }) {
  const adjust = useAction(async (f: FormData) => {
    const usd = Number(String(f.get("usd") ?? "").replace(",", "."));
    await adjustAiBalanceFn({ data: { botId: c.id, usd, note: String(f.get("note") ?? "") } });
    await onDone();
  });
  const b = ai.balance;
  return (
    <Card title="ИИ-баланс">
      <p className="mb-3 text-sm">
        {b ? (
          <>
            Остаток: <b>${b.usd.toFixed(2)}</b>{" "}
            {b.empty ? (
              <Badge tone="danger">закончился</Badge>
            ) : b.low ? (
              <Badge tone="warn">почти закончился</Badge>
            ) : null}
          </>
        ) : (
          <span className="text-muted">
            Ещё не начислен: ${ai.startUsd} придут при первом обращении к ИИ.
          </span>
        )}
      </p>
      <form
        className="mb-4 grid gap-3 sm:grid-cols-[8rem_1fr_auto] sm:items-end"
        onSubmit={(e: FormEvent<HTMLFormElement>) => {
          e.preventDefault();
          void adjust.run(new FormData(e.currentTarget)).catch(() => {});
        }}
      >
        <Field label="Сумма, $" hint="− снять">
          <input className="input" name="usd" type="number" step="0.01" required />
        </Field>
        <Field label="За что">
          <input
            className="input"
            name="note"
            required
            maxLength={200}
            placeholder="Перевод вне счёта"
          />
        </Field>
        <button className="btn-secondary" disabled={adjust.busy}>
          Записать
        </button>
      </form>
      <ErrorBox error={adjust.error} />
      {ai.journal.length === 0 ? (
        <p className="text-sm text-muted">Журнал пуст.</p>
      ) : (
        <table className="table">
          <tbody>
            {ai.journal.map((r, i) => (
              <tr key={i}>
                <td className="whitespace-nowrap text-muted">
                  {r.type === "ledger" ? new Date(r.at).toLocaleString("ru") : r.date}
                </td>
                <td>
                  {r.type === "ledger"
                    ? `${KIND[r.kind] ?? r.kind}${r.note ? ` · ${r.note}` : ""}${r.actor ? ` · ${r.actor}` : ""}`
                    : `${r.label}: ${r.calls}`}
                </td>
                <td className="whitespace-nowrap text-right">
                  {r.type === "ledger" ? money(r.usd) : money(-r.usd)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}
