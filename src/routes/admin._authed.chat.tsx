import { HelpTip } from "@/app/admin/help-panel";
import { CONTACTS_MIN_ROLE, canEdit, roleAllows } from "@/core/auth/roles";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import {
  chatConnectFn,
  chatConversationsFn,
  chatSearchFn,
  chatInboxPageFn,
  chatInboxPollFn,
  chatInvoiceModesFn,
  chatEarlierFn,
  chatMessagesFn,
  chatReplyFn,
  chatResumeBotFn,
  inboxSetFn,
  quickReplyFillFn,
} from "@/app/admin/chat.functions";
import { adminT, intlLocale } from "@/app/i18n/admin";
import { Badge, Empty, ErrorBox, PageTitle, useAction } from "@/app/ui";
import { uploadFile } from "@/app/admin/upload-client";
import { mergeMessages } from "@/core/chat/merge-messages";
import { SEARCH_MIN } from "@/core/chat/search";
import { isIndefinite } from "@/core/consultant/pause";
import { consultantWorkspace } from "@/app/admin/nav-model";
import { JournalPanel, useWaitingTasks, WaitingList } from "@/app/admin/workspace-dialogs";
import { replyWindow, windowNotice } from "@/core/chat/reply-window";
import {
  matchesInbox,
  type InboxFilter,
  type InboxItem,
  type QuickReply,
} from "@/core/inbox/inbox";
import {
  type Thread,
  type ChatAttachment,
  threadOf,
  POLL_MS,
  PHOTO_TYPES,
  CHANNEL,
  label,
  channelOf,
  stripHtml,
  WindowBadge,
  invoiceModeOf,
  BUBBLE,
  WhyBot,
  ATTACH_ACCEPT,
} from "@/app/admin/chat/parts";
import { UnansweredAlert, QuickReplies } from "@/app/admin/chat/replies";
import { InboxFilters } from "@/app/admin/chat/inbox-filters";
import { CustomerPanelView } from "@/app/admin/chat/customer-panel";
import { InvoicePanel } from "@/app/admin/chat/invoice-panel";

/** Переписка с покупателями: страница; карточка покупателя, фильтры, счёт и быстрые ответы — в app/admin/chat/. */

export const Route = createFileRoute("/admin/_authed/chat")({
  // ?c=<id покупателя> — открыть диалог сразу (ссылка из «Обращений»).
  validateSearch: z.object({ c: z.coerce.number().int().optional() }),
  loader: () => chatConversationsFn(),
  component: ChatPage,
});

function ChatPage() {
  const initial = Route.useLoaderData();
  const { shop } = Route.useRouteContext();
  const t = adminT(shop.locale);
  const loc = intlLocale(shop.locale);
  const [conversations, setConversations] = useState<InboxItem[]>(initial.conversations);
  const [hasMore, setHasMore] = useState(initial.hasMore);
  // Курсор «читать дальше», когда сервер упёрся в потолок порций при редком фильтре.
  const [nextCursor, setNextCursor] = useState(initial.next);
  const [totals, setTotals] = useState(initial.totals);
  // Открытый диалог держим отдельно: под фильтром или поиском его может не быть в списке.
  const [openedItem, setOpenedItem] = useState<InboxItem | null>(null);
  const [quickReplies, setQuickReplies] = useState<QuickReply[]>(initial.quickReplies);
  const [editingQuick, setEditingQuick] = useState(false);
  const [invoicing, setInvoicing] = useState(false);
  // Как счёт дойдёт до покупателя каждого канала: кнопкой, ссылкой на сайт или никак.
  const [invoiceModes, setInvoiceModes] = useState<Awaited<
    ReturnType<typeof chatInvoiceModesFn>
  > | null>(null);
  useEffect(() => {
    void chatInvoiceModesFn()
      .then(setInvoiceModes)
      .catch(() => {});
  }, []);
  const [filter, setFilter] = useState<InboxFilter>({ status: "open", who: "all", channel: "all" });
  const [searchText, setSearchText] = useState("");
  const canWrite = canEdit(shop.role);
  // Рабочее место консультанта без продаж: «Диалоги» — кто ждёт менеджера и журнал консультанта.
  const ws = consultantWorkspace(shop);
  const contacts = roleAllows(shop.role, CONTACTS_MIN_ROLE);
  const waiting = useWaitingTasks(ws && contacts);
  const [waitingOnly, setWaitingOnly] = useState(false);
  const [showJournal, setShowJournal] = useState(false);
  const me = initial.me;
  // Опрос и действия видят актуальные фильтр и границу «что изменилось», а не замкнутые значения.
  const live = useRef({ filter, since: "", sig: "", unread: 0 });
  live.current.filter = filter;
  const visible = conversations;
  const counts = totals;
  const assigneeName = (u: string | null) => {
    if (!u) return t("chat.nobody");
    const a = initial.assignees.find((x) => x.username === u);
    return a?.name ? `${a.name} (${u})` : u;
  };
  const [selectedId, setSelectedId] = useState<number | null>(Route.useSearch().c ?? null);
  // Переписка и последнее входящее (окно 24 часа) — для диалога telegramId.
  const [thread, setThread] = useState<Thread>({
    telegramId: null,
    messages: [],
    hasMore: false,
    lastInboundAt: null,
    waTemplate: null,
    clockOffset: 0,
  });
  const messages = thread.messages;
  const [reply, setReply] = useState("");
  // Id черновика — ключ идемпотентности отправки в Instagram/WhatsApp (новый на каждый диалог).
  const draftId = useRef(crypto.randomUUID());
  // Фото или документ к ответу: уже в хранилище, уйдёт вместе с текстом.
  const [attachment, setAttachment] = useState<ChatAttachment | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const selected =
    conversations.find((c) => c.telegram_id === selectedId) ??
    (openedItem && openedItem.telegram_id === selectedId ? openedItem : null);
  // Окно ответа Instagram/WhatsApp — только когда переписка этого диалога уже загружена.
  const window24 =
    selected && thread.telegramId === selected.telegram_id
      ? replyWindow(selected.platform, thread.lastInboundAt, Date.now() + thread.clockOffset)
      : null;

  const notice = selected ? windowNotice(selected.platform, window24, thread.waTemplate) : null;

  /** Слияние свежих диалогов в список: подходящие под фильтр заменяются или добавляются, прочие уходят. */
  const mergeChanged = (items: InboxItem[], f: InboxFilter) =>
    setConversations((cur) => {
      const byId = new Map(cur.map((c) => [c.telegram_id, c]));
      for (const i of items) {
        if (matchesInbox(i, f, me)) byId.set(i.telegram_id, i);
        else byId.delete(i.telegram_id);
      }
      return [...byId.values()].sort(
        (a, b) =>
          (a.last_message_at < b.last_message_at
            ? 1
            : a.last_message_at > b.last_message_at
              ? -1
              : 0) || b.telegram_id - a.telegram_id,
      );
    });
  /** Коллега прочитал диалог — у тех, кого нет среди непрочитанных, отметка снимается. */
  const applyUnread = (ids: readonly number[], f: InboxFilter) => {
    const unread = new Set(ids);
    setConversations((cur) =>
      cur
        .map((c) =>
          c.unread_count > 0 && !unread.has(c.telegram_id) ? { ...c, unread_count: 0 } : c,
        )
        .filter((c) => matchesInbox(c, f, me)),
    );
  };
  const noteTotals = (tt: typeof totals) => {
    live.current.sig = JSON.stringify(tt);
    live.current.unread = tt.unread;
    setTotals(tt);
  };
  /** Первая страница под фильтр: целиком заменяет список (смена фильтра, поиск) или вливается в него. */
  const loadFirstPage = async (f: InboxFilter, replace: boolean) => {
    const r = await chatInboxPageFn({ data: { filter: f } });
    if (live.current.filter !== f) return;
    noteTotals(r.totals);
    if (replace) {
      setConversations(r.conversations);
      setHasMore(r.hasMore);
      setNextCursor(r.next);
    } else mergeChanged(r.conversations, f);
  };
  const refreshList = async () => loadFirstPage(live.current.filter, false);
  // Эффекты опроса и поиска вызывают актуальные обработчики через ref, а не замкнутые на старый рендер.
  const fns = useRef({
    mergeChanged,
    applyUnread,
    noteTotals,
    refreshList,
    changeFilter: (_f: InboxFilter) => {},
  });
  useEffect(() => {
    live.current.sig = JSON.stringify(initial.totals);
    live.current.unread = initial.totals.unread;
    live.current.since = initial.asOf;
  }, [initial.totals, initial.asOf]);
  const changeFilter = (f: InboxFilter) => {
    live.current.filter = f;
    setFilter(f);
    void loadFirstPage(f, true).catch(setLoadError);
  };
  fns.current = { mergeChanged, applyUnread, noteTotals, refreshList, changeFilter };
  const loadMore = useAction(async () => {
    const last = conversations[conversations.length - 1];
    const before =
      nextCursor ??
      (last ? { last_message_at: last.last_message_at, telegram_id: last.telegram_id } : null);
    if (!before) return;
    const f = live.current.filter;
    const r = await chatInboxPageFn({ data: { filter: f, before } });
    if (live.current.filter !== f) return;
    noteTotals(r.totals);
    setConversations((cur) => {
      const have = new Set(cur.map((c) => c.telegram_id));
      return [...cur, ...r.conversations.filter((c) => !have.has(c.telegram_id))];
    });
    setHasMore(r.hasMore);
    setNextCursor(r.next);
  });
  // Поиск на сервере: запрос уходит после паузы в наборе.
  useEffect(() => {
    if ((live.current.filter.search ?? "") === searchText.trim()) return;
    const timer = setTimeout(
      () => fns.current.changeFilter({ ...live.current.filter, search: searchText.trim() }),
      350,
    );
    return () => clearTimeout(timer);
  }, [searchText]);

  // Опрос: список — только изменившееся с прошлого раза, переписка — для открытого диалога.
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const r = await chatInboxPollFn({
          data: {
            since: live.current.since,
            unread: live.current.unread,
            ...(selectedId !== null ? { selectedId } : {}),
          },
        });
        if (alive) {
          const f = live.current.filter;
          const sig = JSON.stringify(r.totals);
          // Граница — от сервера: в неё входят и смены статуса/ответственного, а не только реплики.
          if (r.asOf > live.current.since) live.current.since = r.asOf;
          if (r.changed.length) fns.current.mergeChanged(r.changed, f);
          // Счётчики сдвинулись без новых реплик (кто-то решил, назначил, прочитал) — перечитываем начало списка.
          else if (sig !== live.current.sig) await fns.current.refreshList();
          fns.current.noteTotals(r.totals);
          if (r.unreadIds) fns.current.applyUnread(r.unreadIds, f);
          if (r.selected) setOpenedItem(r.selected);
        }
        if (selectedId !== null) {
          const m = await chatMessagesFn({ data: { telegramId: selectedId } });
          if (alive) setThread((p) => threadOf(p, selectedId, m));
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

  // К низу — при новом последнем сообщении и смене диалога, но не когда сверху подгрузили историю.
  const lastMessageId = messages[messages.length - 1]?.id;
  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lastMessageId, selectedId]);

  // Поиск по тексту переписки: находки вместо списка диалогов; переход к находке подгружает историю до неё.
  const [textQuery, setTextQuery] = useState("");
  const [hits, setHits] = useState<{
    q: string;
    items: Awaited<ReturnType<typeof chatSearchFn>>["hits"];
    hasMore: boolean;
  } | null>(null);
  const [jump, setJump] = useState<{ telegramId: number; id: string } | null>(null);
  const jumped = useRef<string | null>(null);
  useEffect(() => {
    const q = textQuery.trim();
    if (q.length < SEARCH_MIN) {
      setHits(null);
      return;
    }
    let alive = true;
    const timer = setTimeout(() => {
      chatSearchFn({ data: { q } }).then(
        (r) => alive && setHits({ q, items: r.hits, hasMore: r.hasMore }),
        (e) => alive && setLoadError(e),
      );
    }, 400);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [textQuery]);
  const moreHits = useAction(async () => {
    const last = hits?.items[hits.items.length - 1];
    if (!hits || !last) return;
    const r = await chatSearchFn({
      data: { q: hits.q, before: { created_at: last.createdAt, id: last.id } },
    });
    setHits((cur) =>
      cur && cur.q === hits.q
        ? { ...cur, items: [...cur.items, ...r.hits], hasMore: r.hasMore }
        : cur,
    );
  });

  const loadEarlier = useAction(async () => {
    const first = messages[0];
    if (selectedId === null || !first) return;
    const page = await chatEarlierFn({
      data: { telegramId: selectedId, before: { created_at: first.created_at, id: first.id } },
    });
    const el = threadRef.current;
    const height = el?.scrollHeight ?? 0;
    setThread((p) =>
      p.telegramId === selectedId
        ? { ...p, messages: mergeMessages(p.messages, page.messages), hasMore: page.hasMore }
        : p,
    );
    // Показанное сообщение остаётся на месте: прокрутка сдвигается на высоту подгруженного.
    requestAnimationFrame(() => {
      if (el) el.scrollTop += el.scrollHeight - height;
    });
  });
  // Находка открыта: подгружаем историю страницами, пока сообщение не появится, и прокручиваем к нему.
  useEffect(() => {
    if (!jump) return;
    if (selectedId !== jump.telegramId) {
      setJump(null);
      return;
    }
    if (thread.telegramId !== jump.telegramId) return;
    if (thread.messages.some((m) => m.id === jump.id)) {
      if (jumped.current === jump.id) return;
      jumped.current = jump.id;
      requestAnimationFrame(() =>
        document.getElementById(`msg-${jump.id}`)?.scrollIntoView({ block: "center" }),
      );
    } else if (thread.hasMore && !loadEarlier.busy && !loadEarlier.error)
      void loadEarlier.run().catch(() => {});
  }, [jump, selectedId, thread, loadEarlier]);

  const setMeta = useAction(
    async (patch: { status?: "open" | "closed"; assignee?: string | null }) => {
      if (!selected) return;
      const r = await inboxSetFn({ data: { telegramId: selected.telegram_id, ...patch } });
      setConversations((cs) =>
        cs.map((c) => (c.telegram_id === selected.telegram_id ? { ...c, ...r } : c)),
      );
    },
  );
  const toggle = useAction(async () => {
    if (!selected) return;
    await chatConnectFn({ data: { telegramId: selected.telegram_id, active: !selected.active } });
    await refreshList();
  });
  const resumeBot = useAction(async () => {
    if (!selected) return;
    await chatResumeBotFn({ data: { telegramId: selected.telegram_id } });
    await refreshList();
  });
  useEffect(() => {
    setAttachment(null);
    setShowJournal(false);
    draftId.current = crypto.randomUUID();
  }, [selectedId]);
  const attach = useAction(async (file: File) => {
    const kind = PHOTO_TYPES.includes(file.type) ? "photo" : "file";
    const key = await uploadFile(kind === "photo" ? "chatPhoto" : "chatFile", file, t, (status) =>
      t("chat.attachFailed", { status }),
    );
    setAttachment({ kind, key, name: file.name });
  });
  const send = useAction(async () => {
    if (selectedId === null || (!reply.trim() && !attachment)) return;
    await chatReplyFn({
      data: {
        telegramId: selectedId,
        text: reply.trim(),
        ...(attachment ? { attachment } : {}),
        draftId: draftId.current,
      },
    });
    // Ушло — следующий черновик с новым id; после ошибки id прежний.
    draftId.current = crypto.randomUUID();
    setReply("");
    setAttachment(null);
    // Ответ менеджера закрывает задачи покупателя (core/consultant/tasks): «Ждут менеджера» — заново.
    if (ws) void waiting.reload();
    {
      const m = await chatMessagesFn({ data: { telegramId: selectedId } });
      setThread((p) => threadOf(p, selectedId, m));
    }
  });

  return (
    <>
      <PageTitle
        title={ws ? t("ws.dialogs.title") : t("chat.title")}
        subtitle={ws ? t("ws.dialogs.subtitle") : t("chat.subtitle")}
        actions={
          ws && contacts ? (
            <button
              type="button"
              aria-pressed={waitingOnly}
              className={waitingOnly ? "btn-primary text-sm" : "btn-secondary text-sm"}
              onClick={() => setWaitingOnly((v) => !v)}
            >
              {t("ws.dialogs.waiting", { n: waiting.byDialog.size })}
            </button>
          ) : undefined
        }
      />
      <ErrorBox
        error={
          loadError ??
          toggle.error ??
          send.error ??
          attach.error ??
          setMeta.error ??
          resumeBot.error ??
          waiting.failed
        }
      />
      {/* На телефоне открытый диалог занимает экран: напоминание и фильтры — только у списка. */}
      <div className={selected ? "hidden md:block" : undefined}>
        <UnansweredAlert
          t={t}
          initial={initial.unansweredMinutes}
          initialEscalate={initial.unansweredEscalate}
          canWrite={canWrite}
        />
        <InboxFilters
          t={t}
          filter={filter}
          counts={counts}
          search={searchText}
          onSearch={setSearchText}
          onChange={changeFilter}
        />
      </div>
      {/* Телефон: список и переписка раздельно (выбрал — переписка, «К списку» — назад);
          с md — две колонки рядом. */}
      <div
        className={`card grid min-h-[28rem] grid-cols-1 overflow-hidden md:h-[calc(100vh-14rem)] md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] ${selected ? "h-[calc(100dvh-8rem)]" : "h-[calc(100dvh-14rem)]"}`}
        data-testid="chat-split"
      >
        <div
          className={`overflow-y-auto border-line md:border-r ${selected ? "hidden md:block" : ""}`}
          data-testid="chat-list"
        >
          <div className="sticky top-0 z-10 border-b border-line bg-surface p-2">
            <input
              type="search"
              className="input h-8 w-full py-0 text-sm"
              value={textQuery}
              placeholder={t("chat.searchText")}
              aria-label={t("chat.searchText")}
              onChange={(e) => setTextQuery(e.target.value)}
            />
          </div>
          {hits !== null ? (
            <>
              {hits.items.length === 0 && <Empty>{t("chat.searchNone")}</Empty>}
              {hits.items.map((h) => (
                <button
                  key={h.id}
                  type="button"
                  onClick={() => {
                    jumped.current = null;
                    setSelectedId(h.telegramId);
                    setJump({ telegramId: h.telegramId, id: h.id });
                  }}
                  className={`block w-full border-b border-line px-4 py-3 text-left hover:bg-surface-2/60 ${jump?.id === h.id ? "bg-surface-2" : ""}`}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium">{h.name}</span>
                    {CHANNEL[h.platform] && <Badge>{CHANNEL[h.platform]}</Badge>}
                  </span>
                  <span className="mt-1 block text-xs text-muted">{h.snippet}</span>
                  <span className="mt-0.5 block text-[11px] text-muted">
                    {new Date(h.createdAt).toLocaleString(loc)}
                  </span>
                </button>
              ))}
              {hits.hasMore && (
                <button
                  type="button"
                  className="block w-full px-4 py-3 text-center text-xs text-muted hover:bg-surface-2/60"
                  disabled={moreHits.busy}
                  onClick={() => void moreHits.run().catch(() => {})}
                >
                  {t("chat.moreDialogs")}
                </button>
              )}
            </>
          ) : waitingOnly ? (
            <WaitingList
              items={[...waiting.byDialog.values()]}
              t={t}
              loc={loc}
              selectedId={selectedId}
              onPick={setSelectedId}
            />
          ) : visible.length === 0 ? (
            <Empty>{counts.total === 0 ? t("chat.empty") : t("chat.emptyFiltered")}</Empty>
          ) : (
            visible.map((c) => (
              <button
                key={c.telegram_id}
                type="button"
                onClick={() => setSelectedId(c.telegram_id)}
                className={`block w-full border-b border-line px-4 py-3 text-left hover:bg-surface-2/60 ${selectedId === c.telegram_id ? "bg-surface-2" : ""}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium">{label(c)}</span>
                  <span className="flex shrink-0 items-center gap-1">
                    {channelOf(c) && <Badge>{channelOf(c)}</Badge>}
                    {c.tickets.map((n) => (
                      <Badge key={n} tone="warn">
                        {t("chat.ticket", { n })}
                      </Badge>
                    ))}
                    {ws && waiting.byDialog.has(c.telegram_id) && (
                      <Badge tone="warn">{t("ws.dialogs.waitingBadge")}</Badge>
                    )}
                    {c.status === "closed" && <Badge>{t("chat.resolvedBadge")}</Badge>}
                    {c.active && <Badge tone="ok">{t("chat.youInChat")}</Badge>}
                    {c.unread_count > 0 && <Badge tone="accent">{c.unread_count}</Badge>}
                  </span>
                </div>
                <p className="mt-1 truncate text-xs text-muted">
                  {c.last_message_direction === "out" ? t("chat.youPrefix") : ""}
                  {c.last_message_preview
                    ? stripHtml(c.last_message_preview)
                    : t("chat.noMessages")}
                </p>
                <p className="mt-0.5 flex justify-between gap-2 text-[11px] text-muted">
                  <span>{new Date(c.last_message_at).toLocaleString(loc)}</span>
                  {c.assignee && <span className="truncate">{assigneeName(c.assignee)}</span>}
                </p>
              </button>
            ))
          )}
          {hits === null && !waitingOnly && hasMore && (
            <button
              type="button"
              className="block w-full px-4 py-3 text-center text-xs text-muted hover:bg-surface-2/60"
              disabled={loadMore.busy}
              onClick={() => void loadMore.run().catch(() => {})}
            >
              {t("chat.moreDialogs")}
            </button>
          )}
        </div>
        <div className={`min-h-0 flex-col lg:flex-row ${selected ? "flex" : "hidden md:flex"}`}>
          {selected === null ? (
            <p className="m-auto text-sm text-muted">{t("chat.pickDialog")}</p>
          ) : (
            <>
              <div className="flex shrink-0 items-center gap-2 border-b border-line px-2 py-1 md:hidden">
                <button
                  type="button"
                  className="btn-ghost text-xs"
                  onClick={() => setSelectedId(null)}
                >
                  ← {t("chat.backToList")}
                </button>
              </div>
              <CustomerPanelView
                key={selected.telegram_id}
                t={t}
                loc={loc}
                telegramId={selected.telegram_id}
                canOpenCard={roleAllows(shop.role, CONTACTS_MIN_ROLE)}
                canWrite={canWrite}
                sells={!ws}
              />
              <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-2">
                  <span className="text-sm font-medium">
                    {label(selected)}{" "}
                    <span className="text-xs text-muted">
                      {channelOf(selected) ??
                        (selected.username
                          ? `@${selected.username}`
                          : `id ${selected.telegram_id}`)}
                    </span>
                    {selected.bot_paused_until && (
                      <span className="flex items-center gap-1.5 text-xs text-muted">
                        <HelpTip article="chat" anchor="resume-bot" />
                        {isIndefinite(selected.bot_paused_until)
                          ? t("chat.botPausedForever")
                          : t("chat.botPausedUntil", {
                              time: new Date(selected.bot_paused_until).toLocaleString(loc, {
                                day: "numeric",
                                month: "short",
                                hour: "2-digit",
                                minute: "2-digit",
                              }),
                            })}
                      </span>
                    )}
                    {window24 && <WindowBadge t={t} w={window24} />}
                    {window24 && <HelpTip article="chat" anchor="window-24h" />}
                  </span>
                  {(canWrite || (ws && contacts && selected.user_key)) && (
                    <span className="flex flex-wrap items-center justify-end gap-2">
                      {ws && contacts && selected.user_key && (
                        <button
                          type="button"
                          aria-pressed={showJournal}
                          className={showJournal ? "btn-primary text-xs" : "btn-secondary text-xs"}
                          onClick={() => setShowJournal((v) => !v)}
                        >
                          {t("ws.journal.title")}
                        </button>
                      )}
                      {canWrite && (
                        <>
                          <HelpTip article="chat" anchor="assignee" />
                          <select
                            className="input h-8 w-auto py-0 text-xs"
                            aria-label={t("chat.assignee")}
                            value={selected.assignee ?? ""}
                            disabled={setMeta.busy}
                            onChange={(e) =>
                              void setMeta.run({ assignee: e.target.value || null }).catch(() => {})
                            }
                          >
                            <option value="">
                              {t("chat.assignee")}: {t("chat.nobody")}
                            </option>
                            {initial.assignees.map((a) => (
                              <option key={a.username} value={a.username}>
                                {a.name ?? a.username}
                                {a.owner ? ` (${t("chat.owner")})` : ""}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            className="btn-secondary text-xs"
                            disabled={setMeta.busy}
                            onClick={() =>
                              void setMeta
                                .run({ status: selected.status === "open" ? "closed" : "open" })
                                .catch(() => {})
                            }
                          >
                            {selected.status === "open" ? t("chat.resolve") : t("chat.reopen")}
                          </button>
                          {selected.bot_paused_until && (
                            <button
                              type="button"
                              className="btn-secondary text-xs"
                              disabled={resumeBot.busy}
                              onClick={() => void resumeBot.run().catch(() => {})}
                            >
                              {t("chat.resumeBot")}
                            </button>
                          )}
                          {invoiceModeOf(invoiceModes, selected) !== "none" && (
                            <button
                              type="button"
                              className="btn-secondary text-xs"
                              onClick={() => setInvoicing((v) => !v)}
                            >
                              {t("chat.invoice")}
                            </button>
                          )}
                          <button
                            type="button"
                            className={
                              selected.active ? "btn-secondary text-xs" : "btn-primary text-xs"
                            }
                            disabled={toggle.busy}
                            onClick={() => void toggle.run().catch(() => {})}
                          >
                            {selected.active ? t("chat.returnToBot") : t("chat.join")}
                          </button>
                          <HelpTip article="chat" anchor="join" />
                        </>
                      )}
                    </span>
                  )}
                </div>
                {showJournal && selected.user_key && (
                  <JournalPanel
                    key={selected.user_key}
                    userKey={selected.user_key}
                    t={t}
                    loc={loc}
                  />
                )}
                <div
                  ref={threadRef}
                  className={`min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-4 ${showJournal ? "hidden" : "flex"}`}
                >
                  {thread.telegramId === selected.telegram_id && thread.hasMore && (
                    <button
                      type="button"
                      className="self-center rounded border border-line px-3 py-1 text-xs text-muted hover:bg-line/40"
                      disabled={loadEarlier.busy}
                      onClick={() => void loadEarlier.run().catch(() => {})}
                    >
                      {t("chat.showEarlier")}
                    </button>
                  )}
                  {messages.map((m) => (
                    <div
                      key={m.id}
                      id={`msg-${m.id}`}
                      className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${BUBBLE[m.sender] ?? BUBBLE.bot} ${jump?.id === m.id ? "ring-2 ring-accent" : ""}`}
                    >
                      {m.sender === "bot" && (
                        <p className="mb-1 text-[10px] tracking-wide text-muted uppercase">
                          {t("chat.botAuto")}
                        </p>
                      )}
                      <p className="whitespace-pre-wrap">{stripHtml(m.text)}</p>
                      {m.sender === "bot" && <WhyBot reason={m.reason} t={t} />}
                      <p className="mt-1 text-[10px] text-muted">
                        {new Date(m.created_at).toLocaleString(loc)}
                      </p>
                    </div>
                  ))}
                </div>
                {canWrite &&
                  !ws &&
                  channelOf(selected) &&
                  invoiceModeOf(invoiceModes, selected) === "none" && (
                    <p className="border-b border-line px-4 py-2 text-xs text-muted">
                      {invoiceModes?.storefront
                        ? t("chat.invoiceUnavailable")
                        : t("chat.invoiceNoStorefront")}
                    </p>
                  )}
                {canWrite && invoicing && invoiceModeOf(invoiceModes, selected) !== "none" && (
                  <InvoicePanel
                    key={selected.telegram_id}
                    t={t}
                    link={invoiceModeOf(invoiceModes, selected) === "link"}
                    telegramId={selected.telegram_id}
                    onClose={() => setInvoicing(false)}
                    onSent={async () => {
                      const m = await chatMessagesFn({
                        data: { telegramId: selected.telegram_id },
                      });
                      setThread((p) => threadOf(p, selected.telegram_id, m));
                      await refreshList();
                    }}
                  />
                )}
                {canWrite && (
                  <QuickReplies
                    t={t}
                    replies={quickReplies}
                    editing={editingQuick}
                    onEdit={setEditingQuick}
                    onSaved={setQuickReplies}
                    onPick={async (r) => {
                      // Подстановки ({name}, {order}, {ticket}) собирает сервер: заказ и обращение — из базы.
                      // Не получилось — вставляем как есть: продавец увидит {name} и поправит.
                      const text = await quickReplyFillFn({
                        data: { telegramId: selected.telegram_id, text: r.text },
                      }).then(
                        (x) => x.text,
                        () => r.text,
                      );
                      setReply((cur) => (cur.trim() ? `${cur}\n` : "") + text);
                    }}
                  />
                )}
                {canWrite && notice && (
                  <p className="border-t border-line px-3 pt-2 text-xs text-warn">
                    {notice.key === "whatsappTemplate"
                      ? t("chat.windowTemplate", { name: notice.template })
                      : notice.key === "whatsappNoTemplate"
                        ? t("chat.windowClosedWhatsapp")
                        : t("chat.windowClosedInstagram")}
                  </p>
                )}
                {canWrite && (
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
                          ? t("chat.placeholderActive")
                          : t("chat.placeholderInactive")
                      }
                      value={reply}
                      onChange={(e) => setReply(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && (e.ctrlKey || e.metaKey))
                          void send.run().catch(() => {});
                      }}
                    />
                    <div className="flex flex-col items-end gap-1 self-end">
                      <input
                        ref={fileRef}
                        type="file"
                        className="hidden"
                        accept={ATTACH_ACCEPT}
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          e.target.value = "";
                          if (f) void attach.run(f).catch(() => {});
                        }}
                      />
                      {attachment ? (
                        <span className="flex max-w-48 items-center gap-1 text-xs text-muted">
                          <span className="truncate" title={attachment.name}>
                            {attachment.kind === "photo" ? "🖼" : "📎"} {attachment.name}
                          </span>
                          <button
                            type="button"
                            className="text-accent hover:underline"
                            aria-label={t("chat.attachRemove")}
                            onClick={() => setAttachment(null)}
                          >
                            ✕
                          </button>
                        </span>
                      ) : (
                        <button
                          type="button"
                          className="btn-secondary text-xs"
                          title={t("chat.attachHint")}
                          disabled={attach.busy}
                          onClick={() => fileRef.current?.click()}
                        >
                          {attach.busy ? t("chat.attaching") : t("chat.attach")}
                        </button>
                      )}
                      <button
                        className="btn-primary"
                        disabled={(!reply.trim() && !attachment) || send.busy || attach.busy}
                      >
                        {t("chat.send")}
                      </button>
                      <span className="self-center">
                        <HelpTip article="chat" anchor="reply" />
                      </span>
                    </div>
                  </form>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
