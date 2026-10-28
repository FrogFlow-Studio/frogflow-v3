import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { WorkspaceTool } from "@/app/operator/workspace";
import { useEffect, useState } from "react";
import { z } from "zod";
import {
  supportConversationFn,
  supportInboxFn,
  supportLabelsFn,
  supportNoteFn,
  supportReplyFn,
  supportStatusFn,
} from "@/app/operator/support.functions";
import { Badge, Card, Empty, ErrorBox, PageTitle, useAction } from "@/app/ui";
import { minutesLabel } from "@/core/support/response";
import { QUICK_REPLIES, quickReplyText } from "@/core/support/quick-replies";
import {
  STATUS_LABEL_RU,
  SUPPORT_BODY_MAX,
  SUPPORT_LABEL_PRESETS,
  SUPPORT_NOTE_MAX,
  THREAD_STATUSES,
  type ThreadStatus,
} from "@/core/support/support";

export const Route = createFileRoute("/operator/_authed/support")({
  validateSearch: z.object({
    bot: z.string().uuid().optional(),
    status: z.enum(THREAD_STATUSES).optional(),
    label: z.string().max(30).optional(),
  }),
  loaderDeps: ({ search }) => ({ bot: search.bot, status: search.status, label: search.label }),
  loader: async ({ deps }) => ({
    inbox: await supportInboxFn({ data: { status: deps.status, label: deps.label } }),
    conversation: deps.bot ? await supportConversationFn({ data: { botId: deps.bot } }) : null,
  }),
  component: SupportInbox,
});

/** Что сказать оператору, если продавцу в Telegram уведомление не ушло. */
const NOTICE_TEXT: Record<string, string | undefined> = {
  no_telegram:
    "Ответ сохранён, но в Telegram не ушёл: у магазина нет бота или Telegram-id для уведомлений. Продавец увидит его в админке.",
  failed: "Ответ сохранён, но Telegram уведомление не принял. Продавец увидит его в админке.",
  skipped: "Ответ сохранён. Магазин не на v2 или в архиве, уведомление не отправлялось.",
};

const STATUS: Record<ThreadStatus, { label: string; tone: "accent" | "warn" | "ok" }> = {
  new: { label: "новое", tone: "accent" },
  in_progress: { label: "в работе", tone: "accent" },
  waiting_seller: { label: "ждёт продавца", tone: "warn" },
  resolved: { label: "решено", tone: "ok" },
};

/** Входящие чата поддержки: все клиенты, непрочитанные сверху; справа — переписка. */
function SupportInbox() {
  const { inbox, conversation } = Route.useLoaderData();
  const { bot, status: statusFilter, label: labelFilter } = Route.useSearch();
  const router = useRouter();
  const [text, setText] = useState("");
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void router.invalidate();
    }, 30_000);
    return () => clearInterval(id);
  }, [router]);
  const [notice, setNotice] = useState<string | null>(null);
  const reply = useAction(async () => {
    if (!bot) return;
    const r = await supportReplyFn({ data: { botId: bot, body: text } });
    setNotice(NOTICE_TEXT[r.notice] ?? null);
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
        subtitle={`Обращений в работе: ${inbox.rows.length}, решённых: ${inbox.resolved}. Среднее время первого ответа за неделю: ${inbox.week.avgMinutes === null ? "данных нет" : `${minutesLabel(inbox.week.avgMinutes)} рабочего времени (обращений: ${inbox.week.count})`}. Новые ответы клиентов подтягиваются раз в полминуты.`}
      />
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        <Link
          to="/operator/support"
          search={{ bot }}
          className={`btn-secondary ${!statusFilter && !labelFilter ? "font-semibold" : ""}`}
        >
          В работе
        </Link>
        {THREAD_STATUSES.map((st) => (
          <Link
            key={st}
            to="/operator/support"
            search={{ bot, status: st }}
            className={`btn-secondary ${statusFilter === st ? "font-semibold" : ""}`}
          >
            {STATUS_LABEL_RU[st]} · {inbox.counts[st]}
          </Link>
        ))}
        {inbox.labels.map((l) => (
          <Link
            key={l.label}
            to="/operator/support"
            search={{
              bot,
              status: statusFilter,
              label: labelFilter === l.label ? undefined : l.label,
            }}
            className={`btn-secondary ${labelFilter === l.label ? "font-semibold" : ""}`}
          >
            #{l.label} · {l.count}
          </Link>
        ))}
      </div>
      <div className="operator-support-layout" data-selected={Boolean(bot)}>
        <Card>
          {inbox.rows.length === 0 ? (
            <Empty>
              {statusFilter || labelFilter
                ? "По этому фильтру обращений нет."
                : "Открытых обращений нет."}
            </Empty>
          ) : (
            <ul className="divide-y divide-line">
              {inbox.rows.map((r) => (
                <li key={r.threadId}>
                  <Link
                    to="/operator/support"
                    search={{ bot: r.botId, status: statusFilter, label: labelFilter }}
                    className={`flex items-center justify-between gap-2 px-3 py-2 hover:bg-surface-2 ${
                      r.botId === bot ? "bg-surface-2" : ""
                    }`}
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{r.client}</span>
                      <span className="text-xs text-muted">
                        {fmt(r.lastMessageAt)}
                        {r.labels.length > 0 && ` · ${r.labels.map((l) => `#${l}`).join(" ")}`}
                      </span>
                      {r.reply && (
                        <span
                          className={`block text-xs ${r.reply.overdue ? "text-danger" : "text-muted"}`}
                        >
                          {r.reply.overdue ? "просрочено, было до " : "ответить до "}
                          {fmt(r.reply.due)}
                        </span>
                      )}
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
              <Link
                to="/operator/support"
                search={{ status: statusFilter, label: labelFilter }}
                className="btn-ghost mb-2 md:hidden"
              >
                К списку обращений
              </Link>
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
              {conversation.status && (
                <WorkspaceTool title="Статус, метки и внутренняя заметка">
                  <ThreadPanel
                    key={`${bot}:${conversation.note.updatedAt ?? ""}`}
                    botId={bot}
                    status={conversation.status}
                    labels={conversation.labels}
                    note={conversation.note}
                    onDone={() => router.invalidate()}
                  />
                </WorkspaceTool>
              )}
              <div className="operator-message-history space-y-3 p-4">
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
                        {m.screenshotUrl && (
                          <a href={m.screenshotUrl} target="_blank" rel="noreferrer">
                            <img
                              src={m.screenshotUrl}
                              alt="Скриншот"
                              className="mb-1 max-h-60 rounded"
                            />
                          </a>
                        )}
                        {m.hasScreenshot && !m.screenshotUrl && (
                          <span className="text-muted">[скриншот: ссылка не выдана]</span>
                        )}
                        {m.body}
                      </div>
                      <span className="mt-0.5 text-xs text-muted">
                        {m.authorName ?? (m.author === "operator" ? "оператор" : "продавец")} ·{" "}
                        {fmt(m.createdAt)}
                        {m.author === "operator" && m.read ? " · прочитано" : ""}
                        {m.context?.page ? ` · страница ${m.context.page}` : ""}
                        {m.context?.orderNo != null ? ` · заказ №${m.context.orderNo}` : ""}
                      </span>
                    </div>
                  ))
                )}
              </div>
              <div className="border-t border-line p-4">
                <ErrorBox error={reply.error} />
                {notice && <p className="mb-2 text-sm text-muted">{notice}</p>}
                <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
                  <span className="text-muted">Быстрые ответы:</span>
                  {QUICK_REPLIES.map((q) => (
                    <button
                      key={q.id}
                      type="button"
                      className="btn-secondary text-xs"
                      onClick={() => {
                        const insert = quickReplyText(q, conversation.shop.locale, {
                          shop: conversation.shop.name,
                          plan: conversation.shop.planTitle,
                        });
                        setText((cur) => (cur.trim() ? `${cur.trimEnd()}\n\n${insert}` : insert));
                      }}
                    >
                      {q.title}
                    </button>
                  ))}
                </div>
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

type Thread = NonNullable<Awaited<ReturnType<typeof supportConversationFn>>>;

/** Статус, метки и заметка обращения. Заметку продавец не видит: она в таблице без доступа его роли. */
function ThreadPanel({
  botId,
  status,
  labels,
  note,
  onDone,
}: {
  botId: string;
  status: ThreadStatus;
  labels: string[];
  note: Thread["note"];
  onDone: () => Promise<void>;
}) {
  const [custom, setCustom] = useState("");
  const [text, setText] = useState(note.text);
  const setStatus = useAction(async (st: ThreadStatus) => {
    await supportStatusFn({ data: { botId, status: st } });
    await onDone();
  });
  const setLabels = useAction(async (next: string[]) => {
    await supportLabelsFn({ data: { botId, labels: next } });
    setCustom("");
    await onDone();
  });
  const saveNote = useAction(async () => {
    await supportNoteFn({ data: { botId, note: text, expectedAt: note.updatedAt } });
    await onDone();
  });
  const has = (l: string) => labels.some((x) => x.toLowerCase() === l.toLowerCase());
  const toggle = (l: string) =>
    void setLabels
      .run(has(l) ? labels.filter((x) => x.toLowerCase() !== l.toLowerCase()) : [...labels, l])
      .catch(() => {});
  const busy = setStatus.busy || setLabels.busy || saveNote.busy;
  return (
    <div className="space-y-3 border-b border-line px-4 py-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted">Статус:</span>
        {THREAD_STATUSES.map((st) => (
          <button
            key={st}
            type="button"
            className={st === status ? "btn-primary" : "btn-secondary"}
            disabled={busy}
            aria-pressed={st === status}
            onClick={() => st !== status && void setStatus.run(st).catch(() => {})}
          >
            {STATUS_LABEL_RU[st]}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted">Метки:</span>
        {[
          ...SUPPORT_LABEL_PRESETS,
          ...labels.filter(
            (l) => !SUPPORT_LABEL_PRESETS.some((p) => p.toLowerCase() === l.toLowerCase()),
          ),
        ].map((l) => (
          <button
            key={l}
            type="button"
            className={has(l) ? "btn-primary" : "btn-secondary"}
            disabled={busy}
            aria-pressed={has(l)}
            onClick={() => toggle(l)}
          >
            #{l}
          </button>
        ))}
        <input
          className="input w-36"
          value={custom}
          maxLength={30}
          placeholder="своя метка"
          aria-label="Своя метка"
          onChange={(e) => setCustom(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && custom.trim()) {
              e.preventDefault();
              void setLabels.run([...labels, custom]).catch(() => {});
            }
          }}
        />
      </div>
      <div>
        <label className="mb-1 block text-muted" htmlFor="support-note">
          Заметка оператора (продавец её не видит)
        </label>
        <textarea
          id="support-note"
          className="input w-full"
          rows={2}
          maxLength={SUPPORT_NOTE_MAX}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="mt-1 flex items-center justify-between gap-2">
          <span className="text-xs text-muted">
            {note.updatedAt
              ? `Изменена ${new Date(note.updatedAt).toLocaleString("ru", { dateStyle: "short", timeStyle: "short" })}${note.updatedBy ? ` · ${note.updatedBy}` : ""}`
              : "Заметки пока нет"}
          </span>
          <button
            type="button"
            className="btn-secondary"
            disabled={busy || text.trim() === note.text}
            onClick={() => void saveNote.run().catch(() => {})}
          >
            Сохранить заметку
          </button>
        </div>
      </div>
      <ErrorBox error={setStatus.error ?? setLabels.error ?? saveNote.error} />
    </div>
  );
}
