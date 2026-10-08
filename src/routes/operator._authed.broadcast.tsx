import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { broadcastToOwnersFn, ownerBroadcastsFn } from "@/app/operator/owner-messages.functions";
import { listClientsFn } from "@/app/operator/clients.functions";
import { Badge, Card, Empty, ErrorBox, PageTitle, useAction } from "@/app/ui";

export const Route = createFileRoute("/operator/_authed/broadcast")({
  loader: async () => {
    const [clients, history] = await Promise.all([listClientsFn(), ownerBroadcastsFn()]);
    return { clients, history };
  },
  component: BroadcastPage,
});

/** Сообщение владельцам магазинов: обновления платформы, регламентные работы, счета. */
function BroadcastPage() {
  const { clients, history } = Route.useLoaderData();
  const router = useRouter();
  const reachable = clients.filter((c) => c.telegram.connected);
  const [selected, setSelected] = useState<Set<string>>(new Set(reachable.map((c) => c.id)));
  const [text, setText] = useState("");
  const [last, setLast] = useState<Awaited<ReturnType<typeof broadcastToOwnersFn>> | null>(null);
  const send = useAction(async () => {
    if (!confirm(`Отправить сообщение ${selected.size} владельцам?`)) return;
    const r = await broadcastToOwnersFn({ data: { botIds: [...selected], text } });
    setLast(r);
    setText("");
    await router.invalidate();
  });
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <>
      <PageTitle
        title="Сообщение владельцам"
        subtitle="Уходит каждому через его же бота на Telegram-id администраторов магазина. Клиенты без бота или без id — пропускаются с пометкой."
      />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card title="Новое сообщение">
          <textarea
            className="input min-h-32"
            placeholder="🐸 Обновление FrogFlow: …"
            value={text}
            maxLength={4000}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="mt-3 flex items-center justify-between text-sm">
            <span className="text-muted">
              Получателей: <b className="text-fg">{selected.size}</b> из {reachable.length}
            </span>
            <span className="flex gap-2">
              <button
                type="button"
                className="btn-ghost text-xs"
                onClick={() => setSelected(new Set(reachable.map((c) => c.id)))}
              >
                Все
              </button>
              <button
                type="button"
                className="btn-ghost text-xs"
                onClick={() => setSelected(new Set())}
              >
                Никого
              </button>
            </span>
          </div>
          <div className="mt-2 max-h-72 space-y-1 overflow-auto rounded-md border border-line p-2">
            {reachable.map((c) => (
              <label key={c.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggle(c.id)} />
                <span className="truncate">{c.name}</span>
                {c.telegram.username && (
                  <span className="text-xs text-muted">@{c.telegram.username}</span>
                )}
                {c.status !== "active" && <Badge tone="warn">{c.status}</Badge>}
              </label>
            ))}
            {reachable.length === 0 && (
              <p className="text-sm text-muted">Ни у кого не подключён бот.</p>
            )}
          </div>
          <button
            className="btn-primary mt-3"
            disabled={send.busy || !text.trim() || selected.size === 0}
            onClick={() => void send.run().catch(() => {})}
          >
            {send.busy ? "Отправляем…" : "Отправить"}
          </button>
          <ErrorBox error={send.error} />
          {last && (
            <ul className="mt-3 space-y-1 text-sm">
              {last.results.map((r) => (
                <li key={r.bot_id} className="flex items-center gap-2">
                  <Badge
                    tone={r.status === "sent" ? "ok" : r.status === "failed" ? "danger" : "neutral"}
                  >
                    {r.status === "sent" ? "ушло" : r.status === "failed" ? "не ушло" : "пропущен"}
                  </Badge>
                  <span>{r.bot_name}</span>
                  {r.error && <span className="text-xs text-muted">{r.error}</span>}
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="История">
          {history.length === 0 ? (
            <Empty>Сообщений ещё не было.</Empty>
          ) : (
            <ul className="divide-y divide-line">
              {history.map((h) => {
                const sent = h.results.filter((r) => r.status === "sent").length;
                return (
                  <li key={h.id} className="py-3">
                    <div className="flex items-center justify-between gap-2 text-xs text-muted">
                      <span>
                        {new Date(h.created_at).toLocaleString("ru")} · {h.actor} ·{" "}
                        {h.target === "all" ? "всем" : "выбранным"}
                      </span>
                      <span className="tabular-nums">
                        ушло {sent} / {h.results.length}
                      </span>
                    </div>
                    <p className="mt-1 line-clamp-3 text-sm whitespace-pre-wrap">
                      {h.message_text}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
