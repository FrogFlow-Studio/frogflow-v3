import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import {
  supportConversationFn,
  supportInboxFn,
  supportReplyFn,
} from "@/app/operator/operator.functions";
import { Badge, Card, Empty, ErrorBox, PageTitle, useAction } from "@/app/ui";
import { SUPPORT_BODY_MAX, type ThreadStatus } from "@/core/support/support";

export const Route = createFileRoute("/operator/_authed/support")({
  validateSearch: z.object({ bot: z.string().uuid().optional() }),
  loaderDeps: ({ search }) => ({ bot: search.bot }),
  loader: async ({ deps }) => ({
    inbox: await supportInboxFn(),
    conversation: deps.bot ? await supportConversationFn({ data: { botId: deps.bot } }) : null,
  }),
  component: SupportInbox,
});

const STATUS: Record<ThreadStatus, { label: string; tone: "accent" | "warn" | "ok" }> = {
  new: { label: "новое", tone: "accent" },
  in_progress: { label: "в работе", tone: "accent" },
  waiting_seller: { label: "ждёт продавца", tone: "warn" },
  resolved: { label: "решено", tone: "ok" },
};

/** Входящие чата поддержки: все клиенты, непрочитанные сверху; справа — переписка. */
function SupportInbox() {
  const { inbox, conversation } = Route.useLoaderData();
  const { bot } = Route.useSearch();
  const router = useRouter();
  const [text, setText] = useState("");
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void router.invalidate();
    }, 30_000);
    return () => clearInterval(id);
  }, [router]);
  const reply = useAction(async () => {
    if (!bot) return;
    await supportReplyFn({ data: { botId: bot, body: text } });
    setText("");
    await router.invalidate();
  });
  const fmt = (iso: string) =>
    new Date(iso).toLocaleString("ru", { dateStyle: "short", timeStyle: "short" });

  if (!inbox)
    return (
      <>
        <PageTitle title="Поддержка" subtitle="Чат клиентов с платформой." />
        <Card>
          <Empty>
            Таблиц чата в базе ещё нет: раздел включится после миграции 19-1 (применяет Яков).
            Клиентам в админке сейчас показано «скоро».
          </Empty>
        </Card>
      </>
    );
  return (
    <>
      <PageTitle
        title="Поддержка"
        subtitle={`Обращений в работе: ${inbox.rows.length}, решённых: ${inbox.resolved}. Новые ответы клиентов подтягиваются раз в полминуты.`}
      />
      <div className="grid gap-4 md:grid-cols-[minmax(0,20rem)_1fr]">
        <Card>
          {inbox.rows.length === 0 ? (
            <Empty>Открытых обращений нет.</Empty>
          ) : (
            <ul className="divide-y divide-line">
              {inbox.rows.map((r) => (
                <li key={r.threadId}>
                  <Link
                    to="/operator/support"
                    search={{ bot: r.botId }}
                    className={`flex items-center justify-between gap-2 px-3 py-2 hover:bg-surface-2 ${
                      r.botId === bot ? "bg-surface-2" : ""
                    }`}
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{r.client}</span>
                      <span className="text-xs text-muted">{fmt(r.lastMessageAt)}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1">
                      {r.unread > 0 && <Badge tone="danger">{r.unread}</Badge>}
                      <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          {!bot ? (
            <Empty>Выберите обращение слева.</Empty>
          ) : !conversation ? (
            <Empty>Переписка недоступна.</Empty>
          ) : (
            <>
              <div className="flex items-center justify-between border-b border-line px-4 py-3">
                <Link
                  to="/operator/clients/$botId"
                  params={{ botId: bot }}
                  className="font-medium hover:underline"
                >
                  {conversation.client}
                </Link>
                {conversation.status && (
                  <Badge tone={STATUS[conversation.status].tone}>
                    {STATUS[conversation.status].label}
                  </Badge>
                )}
              </div>
              <div className="max-h-[55vh] space-y-3 overflow-y-auto p-4">
                {conversation.messages.length === 0 ? (
                  <Empty>Сообщений пока нет.</Empty>
                ) : (
                  conversation.messages.map((m) => (
                    <div
                      key={m.id}
                      className={`flex flex-col ${m.author === "operator" ? "items-end" : "items-start"}`}
                    >
                      <div
                        className={`max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm ${
                          m.author === "operator"
                            ? "bg-accent/10"
                            : "bg-surface-2 border border-line"
                        }`}
                      >
                        {m.body}
                      </div>
                      <span className="mt-0.5 text-xs text-muted">
                        {m.authorName ?? (m.author === "operator" ? "оператор" : "продавец")} ·{" "}
                        {fmt(m.createdAt)}
                        {m.author === "operator" && m.read ? " · прочитано" : ""}
                      </span>
                    </div>
                  ))
                )}
              </div>
              <div className="border-t border-line p-4">
                <ErrorBox error={reply.error} />
                <textarea
                  className="input w-full"
                  rows={3}
                  maxLength={SUPPORT_BODY_MAX}
                  value={text}
                  placeholder="Ответ клиенту"
                  aria-label="Ответ клиенту"
                  onChange={(e) => setText(e.target.value)}
                />
                <div className="mt-2 text-right">
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={reply.busy || !text.trim()}
                    onClick={() => void reply.run().catch(() => {})}
                  >
                    Ответить
                  </button>
                </div>
              </div>
            </>
          )}
        </Card>
      </div>
    </>
  );
}
