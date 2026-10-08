import { useCallback, useEffect, useState } from "react";
import { Badge, Empty, ErrorBox, useAction } from "@/app/ui";
import type { AdminKey, AdminT } from "@/app/i18n/admin";
import { consultantTasksFn } from "./pricelist.functions";
import { consultantJournalFn } from "./workspace.functions";
import { taskReason, type WsTask } from "./workspace-ui";

/**
 * «Диалоги» рабочего места консультанта без продаж (BOVI): кто ждёт
 * менеджера (открытые задачи) и журнал ответов консультанта по диалогу.
 * Сам чат — обычная страница чата панели (routes/admin._authed.chat).
 */

/** Как часто перечитывать открытые задачи на странице диалогов. */
const WAITING_REFRESH_MS = 30_000;

/**
 * Открытые задачи консультанта (передачи менеджеру) для «Ждут менеджера».
 * Сбой чтения — `failed`, а не «никто не ждёт».
 */
export function useWaitingTasks(enabled: boolean) {
  const [tasks, setTasks] = useState<WsTask[]>([]);
  const [failed, setFailed] = useState<unknown>(null);
  const reload = useCallback(async () => {
    if (!enabled) return;
    try {
      const r = await consultantTasksFn();
      setTasks(r.tasks.filter((x) => !x.done));
      setFailed(null);
    } catch (e) {
      setFailed(e);
    }
  }, [enabled]);
  useEffect(() => {
    if (!enabled) return;
    void reload();
    const timer = setInterval(() => void reload(), WAITING_REFRESH_MS);
    return () => clearInterval(timer);
  }, [enabled, reload]);
  // Один диалог — одна строка, даже если передач у покупателя несколько.
  const byDialog = new Map<number, WsTask>();
  for (const x of tasks)
    if (x.telegramId != null && !byDialog.has(x.telegramId)) byDialog.set(x.telegramId, x);
  return { tasks, byDialog, failed, reload };
}

const CHANNEL_NAMES: Record<string, string> = {
  telegram: "Telegram",
  instagram: "Instagram",
  whatsapp: "WhatsApp",
};

/** Список «Ждут менеджера»: по одной строке на диалог, свежие передачи сверху. */
export function WaitingList({
  items,
  t,
  loc,
  selectedId,
  onPick,
}: {
  items: WsTask[];
  t: AdminT;
  loc: string;
  selectedId: number | null;
  onPick: (telegramId: number) => void;
}) {
  if (items.length === 0) return <Empty>{t("ws.dialogs.waitingEmpty")}</Empty>;
  return (
    <>
      {items.map((x) => (
        <button
          key={x.id}
          type="button"
          onClick={() => onPick(x.telegramId!)}
          className={`block w-full border-b border-line px-4 py-3 text-left hover:bg-surface-2/60 ${selectedId === x.telegramId ? "bg-surface-2" : ""}`}
        >
          <span className="flex items-center justify-between gap-2">
            <span className="truncate text-sm font-medium">{x.name ?? x.contact ?? x.userKey}</span>
            <span className="flex shrink-0 items-center gap-1">
              {x.channel && <Badge>{CHANNEL_NAMES[x.channel]}</Badge>}
              <Badge tone="warn">{taskReason(t, x.reason)}</Badge>
            </span>
          </span>
          {x.text && <span className="mt-1 block truncate text-xs text-muted">{x.text}</span>}
          <span className="mt-0.5 block text-[11px] text-muted">
            {new Date(x.at).toLocaleString(loc)}
          </span>
        </button>
      ))}
    </>
  );
}

type Journal = Awaited<ReturnType<typeof consultantJournalFn>>;
type Entry = Journal["entries"][number];

function outcomeText(
  t: AdminT,
  e: Entry,
): { text: string; tone: "ok" | "warn" | "danger" | "neutral" } {
  const o = e.outcome;
  if (o.kind === "replied") return { text: t("ws.journal.outcome.replied"), tone: "ok" };
  if (o.kind === "failed") return { text: t("ws.journal.outcome.failed"), tone: "danger" };
  if (o.kind === "handoff")
    return {
      text: t("ws.journal.outcome.handoff", { reason: taskReason(t, o.reason) }),
      tone: "warn",
    };
  return { text: t(`ws.journal.silent.${o.why}` as AdminKey), tone: "neutral" };
}

/**
 * Журнал консультанта по диалогу: вопрос покупателя → ответ бота →
 * замечания проверки → чем кончилось. Свежие сверху, страницами.
 */
export function JournalPanel({ userKey, t, loc }: { userKey: string; t: AdminT; loc: string }) {
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [next, setNext] = useState<number | null>(null);
  const first = useAction(async () => {
    const r = await consultantJournalFn({ data: { userKey } });
    setEntries(r.entries);
    setNext(r.hasMore ? r.next : null);
  });
  const more = useAction(async () => {
    if (next === null) return;
    const r = await consultantJournalFn({ data: { userKey, offset: next } });
    setEntries((cur) => {
      const have = new Set((cur ?? []).map((x) => x.id));
      return [...(cur ?? []), ...r.entries.filter((x) => !have.has(x.id))];
    });
    setNext(r.hasMore ? r.next : null);
  });
  useEffect(() => {
    void first.run().catch(() => {});
    // Один раз на диалог: панель с новым userKey монтируется заново (key).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userKey]);
  return (
    <div
      className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-4"
      data-testid="ws-journal"
    >
      <ErrorBox error={first.error ?? more.error} />
      {entries && entries.length === 0 && (
        <p className="text-sm text-muted">{t("ws.journal.empty")}</p>
      )}
      {entries?.map((e) => {
        const o = outcomeText(t, e);
        return (
          <div key={e.id} className="rounded-md border border-line p-3 text-sm">
            <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted">
              <span>{new Date(e.at).toLocaleString(loc)}</span>
              <Badge tone={o.tone}>{o.text}</Badge>
            </div>
            {e.question && (
              <p className="whitespace-pre-wrap">
                <span className="text-xs text-muted">{t("ws.journal.question")}: </span>
                {e.question}
              </p>
            )}
            {e.answer && (
              <p className="mt-1 whitespace-pre-wrap">
                <span className="text-xs text-muted">{t("ws.journal.answer")}: </span>
                {e.answer}
              </p>
            )}
            {e.answer && (
              <p className="mt-1 flex flex-wrap gap-1 text-xs">
                {e.flags.length === 0 ? (
                  <span className="text-ok">{t("ws.journal.clean")}</span>
                ) : (
                  e.flags.map((f) => (
                    <Badge key={f} tone="warn">
                      {t(`ws.flag.${f}` as AdminKey)}
                    </Badge>
                  ))
                )}
              </p>
            )}
          </div>
        );
      })}
      {next !== null && (
        <button
          type="button"
          className="btn-secondary self-center text-xs"
          disabled={more.busy}
          onClick={() => void more.run().catch(() => {})}
        >
          {t("ws.journal.more")}
        </button>
      )}
    </div>
  );
}
