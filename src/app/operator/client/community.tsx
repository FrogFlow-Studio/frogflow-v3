/** Карточка клиента у оператора: сообщество авторов — скрыть или заблокировать. */
import { useEffect, useState } from "react";
import { communityModFn, setCommunityModFn } from "@/app/operator/operator.functions";
import { Card, ErrorBox, useAction } from "@/app/ui";
import type { C } from "./types";

type View = Awaited<ReturnType<typeof communityModFn>>;

const STATE_TEXT: Record<View["state"], string> = {
  off: "Автор не включал сообщество (или магазин не на v2).",
  visible: "Автор виден другим авторам.",
  hidden: "Скрыт: в списке авторов его нет, остальное работает.",
  blocked: "Заблокирован: не виден, не читает и не пишет.",
};

export function CommunityModCard({ c }: { c: C }) {
  const [v, setV] = useState<View | null>(null);
  const [reason, setReason] = useState("");
  const load = useAction(async () => setV(await communityModFn({ data: { botId: c.id } })));
  useEffect(() => {
    void load.run().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c.id]);
  const set = useAction(async (status: "hidden" | "blocked" | null) => {
    await setCommunityModFn({ data: { botId: c.id, status, reason } });
    setReason("");
    await load.run();
  });
  return (
    <Card title="Сообщество авторов">
      <p className="mb-2 text-sm text-muted">{v ? STATE_TEXT[v.state] : "Загрузка…"}</p>
      {v?.mod && (
        <p className="mb-2 text-sm">
          Решение: {v.mod.status === "blocked" ? "заблокирован" : "скрыт"}
          {v.mod.reason ? ` — ${v.mod.reason}` : ""}
        </p>
      )}
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
          disabled={!v || set.busy}
          onClick={() => void set.run("hidden").catch(() => {})}
        >
          Скрыть
        </button>
        <button
          className="btn-secondary text-danger"
          disabled={!v || set.busy}
          onClick={() => void set.run("blocked").catch(() => {})}
        >
          Заблокировать
        </button>
        {v?.mod && (
          <button
            className="btn-ghost"
            disabled={set.busy}
            onClick={() => void set.run(null).catch(() => {})}
          >
            Снять
          </button>
        )}
      </div>
      <ErrorBox error={load.error ?? set.error} />
    </Card>
  );
}
