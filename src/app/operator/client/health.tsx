/** Карточка клиента у оператора: история здоровья бота и сообщение владельцу. */
import { NO_RECIPIENTS_REASON } from "@/core/notify/deliver";
import { useRouter } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import {
  notifyOwnerFn,
  healthHistoryFn,
  recordHealthNowFn,
} from "@/app/operator/operator.functions";
import { Badge, Card, ErrorBox, useAction } from "@/app/ui";
import type { C } from "./types";

type History = Awaited<ReturnType<typeof healthHistoryFn>>;

export function HealthCard({ c }: { c: C }) {
  const router = useRouter();
  const [history, setHistory] = useState<History | null>(null);
  const load = useAction(async () => setHistory(await healthHistoryFn({ data: { botId: c.id } })));
  useEffect(() => {
    void load.run().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c.id]);
  const snap = useAction(async () => {
    await recordHealthNowFn({ data: { botId: c.id } });
    await router.invalidate();
    await load.run();
  });
  const h = c.health;
  return (
    <Card
      title="Здоровье бота"
      actions={
        h ? (
          <Badge tone={h.ok ? "ok" : "danger"}>
            {h.ok ? "работает" : "сбой"} · {new Date(h.at).toLocaleString("ru")}
          </Badge>
        ) : (
          <Badge>снимков нет</Badge>
        )
      }
    >
      {h && !h.ok && h.error && <p className="mb-2 text-sm text-danger">{h.error}</p>}
      {h?.ok && h.pending ? (
        <p className="mb-2 text-sm text-muted">
          В очереди Telegram {h.pending} обновлений — бот отвечает с задержкой.
        </p>
      ) : null}
      {history && history.snapshotCount > 0 ? (
        <>
          <p className="text-sm">
            Аптайм за 14 дней:{" "}
            <span className="font-medium tabular-nums">
              {Math.round((history.uptimeRatio ?? 0) * 1000) / 10}%
            </span>
            <span className="text-muted"> · {history.snapshotCount} снимков</span>
          </p>
          {history.outages.length === 0 ? (
            <p className="mt-1 text-sm text-muted">Простоев не было.</p>
          ) : (
            <ul className="mt-2 divide-y divide-line text-sm">
              {history.outages.slice(0, 8).map((o) => (
                <li key={o.startedAt} className="py-1.5">
                  <span className="tabular-nums">{new Date(o.startedAt).toLocaleString("ru")}</span>
                  {" → "}
                  <span className="tabular-nums">
                    {o.endedAt ? new Date(o.endedAt).toLocaleString("ru") : "сейчас"}
                  </span>
                  {o.error && <span className="block text-xs text-muted">{o.error}</span>}
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <p className="text-sm text-muted">Снимки пишет крон каждые 15 минут для клиентов на v2.</p>
      )}
      <button
        type="button"
        className="btn-secondary mt-3 text-xs"
        disabled={snap.busy || !c.telegram.connected}
        onClick={() => void snap.run().catch(() => {})}
      >
        Проверить сейчас
      </button>
      <ErrorBox error={load.error ?? snap.error} />
    </Card>
  );
}

export function MessageCard({ c }: { c: C }) {
  const [result, setResult] = useState<string | null>(null);
  const send = useAction(async (text: string) => {
    const r = await notifyOwnerFn({ data: { botId: c.id, text } });
    if (r.noRecipients) return setResult(`Не отправлено: ${NO_RECIPIENTS_REASON}.`);
    const failed = r.failed.map((f) => `${f.id}: ${f.reason}`).join("; ");
    setResult(
      r.ok
        ? `Доставлено: ${r.delivered.length}${failed ? `, не доставлено: ${failed}` : ""}`
        : `Не доставлено никому. ${failed}`,
    );
  });
  return (
    <Card
      title="Написать владельцу"
      actions={<span className="text-xs text-muted">от имени его бота</span>}
    >
      <form
        className="space-y-3"
        onSubmit={(e: FormEvent<HTMLFormElement>) => {
          e.preventDefault();
          void send.run(String(new FormData(e.currentTarget).get("text"))).catch(() => {});
        }}
      >
        <textarea className="input" name="text" rows={3} required placeholder="Текст сообщения" />
        <button className="btn-secondary" disabled={send.busy || !c.telegram.connected}>
          Отправить
        </button>
        {result && <p className="text-xs text-muted">{result}</p>}
        <ErrorBox error={send.error} />
      </form>
    </Card>
  );
}
