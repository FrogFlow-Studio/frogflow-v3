/** Карточка клиента у оператора: «Проверить канал» — список «ок / не ок / что сделать». */
import { useState } from "react";
import { diagnoseChannelFn } from "@/app/operator/diagnosis.functions";
import type { DiagChannel, Diagnosis, DiagState } from "@/app/operator/channel-diagnosis";
import { Badge, Card, ErrorBox, useAction } from "@/app/ui";
import type { C } from "./types";

const CHANNELS: Array<{ key: DiagChannel; label: string }> = [
  { key: "telegram", label: "Telegram" },
  { key: "instagram", label: "Instagram" },
  { key: "whatsapp", label: "WhatsApp" },
];
const TONE = { ok: "ok", bad: "danger", info: "neutral" } as const;
const MARK: Record<DiagState, string> = { ok: "✓", bad: "✕", info: "i" };

export function DiagnoseCard({ c }: { c: C }) {
  const [results, setResults] = useState<Partial<Record<DiagChannel, Diagnosis>>>({});
  const [last, setLast] = useState<DiagChannel | null>(null);
  const run = useAction(async (channel: DiagChannel) => {
    const d = await diagnoseChannelFn({ data: { botId: c.id, channel } });
    setResults((r) => ({ ...r, [channel]: d }));
    setLast(channel);
  });
  const shown = last ? results[last] : null;
  return (
    <Card title="Диагностика канала">
      <p className="text-xs text-muted">
        Только чтение: ничего не отправляется ни клиенту, ни покупателям и ничего не повторяется.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {CHANNELS.map((ch) => (
          <button
            key={ch.key}
            className="btn-secondary"
            disabled={run.busy}
            onClick={() => void run.run(ch.key).catch(() => {})}
          >
            Проверить {ch.label}
          </button>
        ))}
      </div>
      <ErrorBox error={run.error} />
      {run.busy && <p className="mt-3 text-sm text-muted">Проверяем…</p>}
      {shown && (
        <div className="mt-4" aria-live="polite">
          <div className="mb-2 flex items-center gap-2 text-sm font-medium">
            {CHANNELS.find((x) => x.key === shown.channel)?.label}
            <Badge tone={shown.verdict === "ok" ? "ok" : "danger"}>
              {shown.verdict === "ok" ? "всё в порядке" : "есть проблема"}
            </Badge>
          </div>
          <ul className="space-y-2 text-xs">
            {shown.checks.map((ch) => (
              <li key={ch.key} className="flex items-start gap-2">
                <Badge tone={TONE[ch.state]}>{MARK[ch.state]}</Badge>
                <span>
                  <span className="font-medium">{ch.title}</span>
                  <span className="block text-muted">{ch.detail}</span>
                  {ch.todo && <span className="block text-warn">Что сделать: {ch.todo}</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
