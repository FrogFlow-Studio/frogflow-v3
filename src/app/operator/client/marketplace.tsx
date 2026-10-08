/** Карточка клиента у оператора: площадка FrogFlow — скрыть магазин или вернуть. */
import { useEffect, useState } from "react";
import { marketplaceModFn, setMarketplaceHiddenFn } from "@/app/operator/moderation.functions";
import { Card, ErrorBox, useAction } from "@/app/ui";
import type { C } from "./types";

type View = Awaited<ReturnType<typeof marketplaceModFn>>;

const STATE_TEXT: Record<View["state"], string> = {
  off: "Магазин не давал согласия на площадку (или не на v2).",
  pending: "Согласие есть, одобрения оператора пока нет: на площадке магазина нет.",
  visible: "Согласие есть и магазин одобрен: показывается на площадке.",
  hidden: "Скрыт оператором: на площадке его нет, остальное работает.",
};

export function MarketplaceModCard({ c }: { c: C }) {
  const [v, setV] = useState<View | null>(null);
  const [reason, setReason] = useState("");
  const load = useAction(async () => setV(await marketplaceModFn({ data: { botId: c.id } })));
  useEffect(() => {
    void load.run().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c.id]);
  const set = useAction(async (hidden: boolean) => {
    await setMarketplaceHiddenFn({ data: { botId: c.id, hidden, reason } });
    setReason("");
    await load.run();
  });
  return (
    <Card title="Площадка FrogFlow">
      <p className="mb-2 text-sm text-muted">{v ? STATE_TEXT[v.state] : "Загрузка…"}</p>
      {v?.hidden && v.hiddenReason && <p className="mb-2 text-sm">Причина: {v.hiddenReason}</p>}
      <input
        className="input mb-2"
        maxLength={300}
        placeholder="Причина (автор её увидит)"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      <div className="flex flex-wrap gap-2">
        <button
          className="btn-secondary"
          disabled={!v || v.state === "hidden" || set.busy}
          onClick={() => void set.run(true).catch(() => {})}
        >
          Скрыть с площадки
        </button>
        {v?.state === "hidden" && (
          <button
            className="btn-ghost"
            disabled={set.busy}
            onClick={() => void set.run(false).catch(() => {})}
          >
            Вернуть
          </button>
        )}
      </div>
      <ErrorBox error={load.error ?? set.error} />
    </Card>
  );
}
