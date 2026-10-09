import { useState } from "react";
import { consultantTestFn } from "@/app/admin/consultant-settings.functions";
import { Badge, Card, ErrorBox, useAction } from "@/app/ui";
import { type AdminT } from "@/app/i18n/admin";

/** Проверочный чат с консультантом. */

export function TestChat({ configured, t }: { configured: boolean; t: AdminT }) {
  const [q, setQ] = useState("");
  const [log, setLog] = useState<
    Array<{ q: string; a: string; handoff: string | null; usd: number }>
  >([]);
  const ask = useAction(async () => {
    const r = await consultantTestFn({ data: { text: q } });
    setLog((l) => [
      ...l,
      {
        q,
        a: r.reply,
        handoff: r.handoff ? `${r.handoff.kind}: ${r.handoff.reason} — ${r.handoff.summary}` : null,
        usd: r.usage.usd,
      },
    ]);
    setQ("");
  });
  return (
    <Card title={t("consultant.test.title")}>
      <p className="mb-3 text-sm text-muted">{t("consultant.test.intro")}</p>
      <div className="mb-3 max-h-80 space-y-3 overflow-auto">
        {log.map((m, i) => (
          <div key={i} className="space-y-1 text-sm">
            <div className="ml-auto w-fit max-w-[90%] rounded-2xl rounded-br-sm bg-accent px-3 py-2 text-accent-fg">
              {m.q}
            </div>
            <div className="w-fit max-w-[90%] rounded-2xl rounded-bl-sm bg-surface-2 px-3 py-2 whitespace-pre-wrap">
              {m.a}
            </div>
            <div className="text-xs text-muted">
              ${m.usd.toFixed(4)}
              {m.handoff && (
                <>
                  {" "}
                  · <Badge tone="warn">{t("consultant.test.handoff")}</Badge> {m.handoff}
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
          placeholder={t("consultant.test.placeholder")}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          disabled={!configured}
        />
        <button className="btn-secondary shrink-0" disabled={!configured || ask.busy || !q.trim()}>
          {ask.busy ? "…" : t("consultant.test.ask")}
        </button>
      </form>
      <ErrorBox error={ask.error} />
    </Card>
  );
}
