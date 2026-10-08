import { useState } from "react";
import { consultantTestFn } from "./admin.functions";
import { Badge, Card, ErrorBox, useAction } from "@/app/ui";
import type { AdminT } from "@/app/i18n/admin";

/**
 * «Проверить консультанта» с историей: пробный диалог из нескольких реплик.
 * История и память пробного диалога живут только в этой карточке и уходят
 * на сервер с каждым вопросом (`consultantTestFn`, dryRun): у покупателей
 * ничего не меняется и никому ничего не отправляется.
 */
export function WorkspaceTestChat({ configured, t }: { configured: boolean; t: AdminT }) {
  type Turn = { role: "customer" | "assistant"; text: string };
  const [q, setQ] = useState("");
  const [history, setHistory] = useState<Turn[]>([]);
  const [extra, setExtra] = useState<string | undefined>(undefined);
  // Что видно на экране — весь пробный диалог; на сервер уходит история, которую он вернул
  // (последние реплики, core/consultant/test-chat).
  const [log, setLog] = useState<
    Array<{ q: string; a: string; usd: number; handoff: string | null }>
  >([]);
  const ask = useAction(async () => {
    const text = q.trim();
    if (!text) return;
    const r = await consultantTestFn({ data: { text, history, extra } });
    setHistory(r.history);
    setExtra(r.extra);
    setLog((l) => [
      ...l,
      {
        q: text,
        a: r.reply,
        usd: r.usage.usd,
        handoff: r.handoff ? `${r.handoff.reason} — ${r.handoff.summary}` : null,
      },
    ]);
    setQ("");
  });
  const restart = () => {
    setHistory([]);
    setExtra(undefined);
    setLog([]);
    setQ("");
  };
  return (
    <Card
      title={t("ws.test.title")}
      actions={
        log.length > 0 ? (
          <button className="btn-ghost text-xs" disabled={ask.busy} onClick={restart}>
            {t("ws.test.restart")}
          </button>
        ) : undefined
      }
    >
      <p className="mb-3 text-sm text-muted">{t("ws.test.intro")}</p>
      <div className="mb-3 max-h-96 space-y-2 overflow-auto" data-testid="ws-test-log">
        {log.length === 0 && <p className="text-sm text-muted">{t("ws.test.empty")}</p>}
        {log.map((m, i) => (
          <div key={i} className="space-y-1 text-sm">
            <div className="ml-auto w-fit max-w-[90%] rounded-2xl rounded-br-sm bg-accent px-3 py-2 text-accent-fg">
              <span className="sr-only">{t("ws.test.you")}: </span>
              {m.q}
            </div>
            <div className="w-fit max-w-[90%] rounded-2xl rounded-bl-sm bg-surface-2 px-3 py-2 whitespace-pre-wrap">
              <span className="sr-only">{t("ws.test.bot")}: </span>
              {m.a}
            </div>
            <div className="text-xs text-muted">
              ${m.usd.toFixed(4)}
              {m.handoff && (
                <>
                  {" "}
                  · <Badge tone="warn">{t("ws.test.handoff")}</Badge> {m.handoff}
                </>
              )}
            </div>
          </div>
        ))}
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void ask.run().catch(() => {});
        }}
      >
        <input
          className="input"
          aria-label={t("ws.test.placeholder")}
          placeholder={t("ws.test.placeholder")}
          value={q}
          maxLength={1000}
          onChange={(e) => setQ(e.target.value)}
          disabled={!configured}
        />
        <button className="btn-primary shrink-0" disabled={!configured || ask.busy || !q.trim()}>
          {ask.busy ? "…" : t("ws.test.ask")}
        </button>
      </form>
      <ErrorBox error={ask.error} />
    </Card>
  );
}
