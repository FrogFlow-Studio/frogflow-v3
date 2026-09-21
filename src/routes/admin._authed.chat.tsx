import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import {
  chatConnectFn,
  chatConversationsFn,
  chatMessagesFn,
  chatReplyFn,
} from "@/app/admin/admin.functions";
import { Badge, Empty, ErrorBox, PageTitle, useAction } from "@/app/ui";
import type { ChatMessage, Conversation } from "@/core/chat/chat";

export const Route = createFileRoute("/admin/_authed/chat")({
  loader: () => chatConversationsFn(),
  component: ChatPage,
});

const POLL_MS = 5000;

function label(c: Conversation): string {
  const name = [c.first_name, c.last_name].filter(Boolean).join(" ");
  return name || (c.username ? `@${c.username}` : `id ${c.telegram_id}`);
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, "");
}

const BUBBLE: Record<string, string> = {
  customer: "self-start bg-surface-2",
  manager: "self-end bg-accent/15",
  bot: "self-end border border-line bg-surface",
};

function ChatPage() {
  const initial = Route.useLoaderData();
  const [conversations, setConversations] = useState<Conversation[]>(initial.conversations);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [reply, setReply] = useState("");
  const [loadError, setLoadError] = useState<unknown>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const selected = conversations.find((c) => c.telegram_id === selectedId) ?? null;

  // Опрос: список — всегда, переписка — для открытого диалога.
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const r = await chatConversationsFn();
        if (alive) setConversations(r.conversations);
        if (selectedId !== null) {
          const m = await chatMessagesFn({ data: { telegramId: selectedId } });
          if (alive) setMessages(m);
        }
        if (alive) setLoadError(null);
      } catch (e) {
        if (alive) setLoadError(e);
      }
    };
    void tick();
    const t = setInterval(() => void tick(), POLL_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [selectedId]);

  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, selectedId]);

  const toggle = useAction(async () => {
    if (!selected) return;
    await chatConnectFn({ data: { telegramId: selected.telegram_id, active: !selected.active } });
    setConversations((await chatConversationsFn()).conversations);
  });
  const send = useAction(async () => {
    if (selectedId === null || !reply.trim()) return;
    await chatReplyFn({ data: { telegramId: selectedId, text: reply.trim() } });
    setReply("");
    setMessages(await chatMessagesFn({ data: { telegramId: selectedId } }));
  });

  return (
    <>
      <PageTitle
        title="Чат с менеджером"
        subtitle="Живые переписки бота с покупателями. Подключитесь к диалогу, чтобы отвечать самому — бот на это время замолчит для этого покупателя."
      />
      <ErrorBox error={loadError ?? toggle.error ?? send.error} />
      <div className="card grid h-[calc(100vh-14rem)] min-h-[28rem] grid-cols-1 overflow-hidden md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <div className="overflow-y-auto border-b border-line md:border-r md:border-b-0">
          {conversations.length === 0 ? (
            <Empty>Диалогов пока нет: как только покупатель напишет боту, он появится здесь.</Empty>
          ) : (
            conversations.map((c) => (
              <button
                key={c.telegram_id}
                type="button"
                onClick={() => setSelectedId(c.telegram_id)}
                className={`block w-full border-b border-line px-4 py-3 text-left hover:bg-surface-2/60 ${selectedId === c.telegram_id ? "bg-surface-2" : ""}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium">{label(c)}</span>
                  <span className="flex shrink-0 items-center gap-1">
                    {c.active && <Badge tone="ok">вы в чате</Badge>}
                    {c.unread_count > 0 && <Badge tone="accent">{c.unread_count}</Badge>}
                  </span>
                </div>
                <p className="mt-1 truncate text-xs text-muted">
                  {c.last_message_direction === "out" ? "Вы: " : ""}
                  {c.last_message_preview ? stripHtml(c.last_message_preview) : "Нет сообщений"}
                </p>
                <p className="mt-0.5 text-[11px] text-muted">
                  {new Date(c.last_message_at).toLocaleString("ru")}
                </p>
              </button>
            ))
          )}
        </div>
        <div className="flex min-h-0 flex-col">
          {selected === null ? (
            <p className="m-auto text-sm text-muted">Выберите диалог слева.</p>
          ) : (
            <>
              <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-2">
                <span className="text-sm font-medium">
                  {label(selected)}{" "}
                  <span className="text-xs text-muted">id {selected.telegram_id}</span>
                </span>
                <button
                  type="button"
                  className={selected.active ? "btn-secondary text-xs" : "btn-primary text-xs"}
                  disabled={toggle.busy}
                  onClick={() => void toggle.run().catch(() => {})}
                >
                  {selected.active ? "Вернуть боту" : "Подключиться к диалогу"}
                </button>
              </div>
              <div
                ref={threadRef}
                className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-4"
              >
                {messages.map((m) => (
                  <div
                    key={m.id}
                    className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${BUBBLE[m.sender] ?? BUBBLE.bot}`}
                  >
                    {m.sender === "bot" && (
                      <p className="mb-1 text-[10px] tracking-wide text-muted uppercase">
                        автоответ бота
                      </p>
                    )}
                    <p className="whitespace-pre-wrap">{stripHtml(m.text)}</p>
                    <p className="mt-1 text-[10px] text-muted">
                      {new Date(m.created_at).toLocaleString("ru")}
                    </p>
                  </div>
                ))}
              </div>
              <form
                className="flex gap-2 border-t border-line p-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  void send.run().catch(() => {});
                }}
              >
                <textarea
                  className="input min-h-10 flex-1"
                  rows={2}
                  placeholder={
                    selected.active
                      ? "Напишите покупателю…"
                      : "Ответ уйдёт покупателю; чтобы бот не отвечал вместо вас — подключитесь к диалогу"
                  }
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.ctrlKey || e.metaKey))
                      void send.run().catch(() => {});
                  }}
                />
                <button className="btn-primary self-end" disabled={!reply.trim() || send.busy}>
                  Отправить
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </>
  );
}
