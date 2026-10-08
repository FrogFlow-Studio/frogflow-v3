/** Карточка клиента у оператора: кто кого пригласил и кнопка «Зачесть месяц». */
import { useEffect, useState } from "react";
import { creditInviteFn, inviteViewFn } from "@/app/operator/client-billing.functions";
import { Card, ErrorBox, useAction } from "@/app/ui";
import type { C } from "./types";

type View = Awaited<ReturnType<typeof inviteViewFn>>;

const BLOCK: Record<NonNullable<NonNullable<View["invitedBy"]>["blocked"]>, string> = {
  already: "Месяц за это приглашение уже зачтён.",
  self: "Похоже, магазин пригласил сам себя (тот же Telegram или контакт владельца): зачёт не выдаётся.",
  not_paid: "Приглашённый ещё не оплатил тариф: зачёт появится после платежа.",
  inviter_gone: "Пригласивший магазин не найден или в архиве.",
};

export function InvitesCard({ c }: { c: C }) {
  const [v, setV] = useState<View | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const load = useAction(async () => setV(await inviteViewFn({ data: { botId: c.id } })));
  useEffect(() => {
    void load.run().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c.id]);
  const credit = useAction(async () => {
    if (!v?.invitedBy) return;
    if (
      !window.confirm(
        `Зачесть месяц магазину «${v.invitedBy.name}»? Платёж на 0 ₸ продлит его подписку.`,
      )
    )
      return;
    const r = await creditInviteFn({ data: { botId: c.id } });
    setDone(`Зачтено: «${r.inviterName}» оплачен до ${r.periodEnd}.`);
    await load.run();
  });
  if (!v || (!v.invitedBy && v.invited.length === 0)) return null;
  return (
    <Card title="Приглашения авторов">
      {v.invitedBy && (
        <div className="mb-3 space-y-2 text-sm">
          <p>
            Приглашён магазином «{v.invitedBy.name}» ·{" "}
            {v.invitedBy.paid ? "тариф оплачен" : "тариф ещё не оплачен"} ·{" "}
            {v.invitedBy.credited ? "месяц зачтён" : "месяц не зачтён"}.
          </p>
          {v.invitedBy.blocked ? (
            <p className="text-muted">{BLOCK[v.invitedBy.blocked]}</p>
          ) : (
            <button
              className="btn-primary text-sm"
              disabled={credit.busy}
              onClick={() => void credit.run().catch(() => {})}
            >
              Зачесть месяц пригласившему
            </button>
          )}
          {done && <p>{done}</p>}
        </div>
      )}
      {v.invited.length > 0 && (
        <div className="text-sm">
          <div className="mb-1 font-medium">Пригласил:</div>
          <ul className="space-y-0.5">
            {v.invited.map((i) => (
              <li key={i.id}>
                {i.name} · {i.paid ? "оплатил" : "не оплатил"} ·{" "}
                {i.credited ? "зачтено" : "не зачтено"}
              </li>
            ))}
          </ul>
        </div>
      )}
      <ErrorBox error={load.error ?? credit.error} />
    </Card>
  );
}
