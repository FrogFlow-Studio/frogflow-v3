import { CONTACTS_MIN_ROLE, canEdit, roleAllows } from "@/core/auth/roles";
import { createFileRoute, Link } from "@tanstack/react-router";
import { formatMoney } from "@/core/money/money";
import { OrderStatus } from "./admin._authed.orders";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import {
  chatConnectFn,
  chatConversationsFn,
  chatCustomerPanelFn,
  chatSearchFn,
  saveCustomerNoteFn,
  chatInboxPageFn,
  chatInboxPollFn,
  chatInvoiceFn,
  chatInvoiceModesFn,
  chatEarlierFn,
  chatMessagesFn,
  chatReplyFn,
  chatResumeBotFn,
  chatUnansweredSaveFn,
  inboxSetFn,
  invoiceCartFn,
  invoiceProductsFn,
  quickRepliesSaveFn,
  quickReplyFillFn,
} from "@/app/admin/admin.functions";
import { adminT, intlLocale, isAdminKey, type AdminT } from "@/app/i18n/admin";
import { Badge, Empty, ErrorBox, PageTitle, useAction } from "@/app/ui";
import { uploadFile } from "@/app/admin/upload-client";
import type { ChatMessage, Conversation } from "@/core/chat/chat";
import { mergeMessages } from "@/core/chat/merge-messages";
import { reasonPairs } from "@/core/chat/reason";
import { SEARCH_MIN } from "@/core/chat/search";
import { UNANSWERED_OPTIONS } from "@/core/chat/unanswered";
import { isIndefinite } from "@/core/consultant/pause";
import {
  replyWindow,
  windowNotice,
  serverClockOffset,
  windowLeftParts,
  type ReplyWindow,
} from "@/core/chat/reply-window";
import {
  matchesInbox,
  type InboxFilter,
  type InboxItem,
  type QuickReply,
} from "@/core/inbox/inbox";

export const Route = createFileRoute("/admin/_authed/chat")({
  // ?c=<id покупателя> — открыть диалог сразу (ссылка из «Обращений»).
  validateSearch: z.object({ c: z.coerce.number().int().optional() }),
  loader: () => chatConversationsFn(),
  component: ChatPage,
});

/** «Почему бот так ответил»: раскрывающаяся строка под ответом бота; без записанной причины её нет. */
function WhyBot({ reason, t }: { reason: string | null | undefined; t: AdminT }) {
  const pairs = reasonPairs(reason);
  if (pairs.length === 0) return null;
  return (
    <details className="mt-1 text-xs text-muted">
      <summary className="cursor-pointer select-none">{t("chatReason.title")}</summary>
      <ul className="mt-1 space-y-0.5">
        {pairs.map((p) => {
          const label: string = `chatReason.${p.key}`;
          return (
            <li key={p.key}>
              {t(isAdminKey(label) ? label : "chatReason.other")}:{" "}
              <span className="font-mono">{p.value === "1" ? "✓" : p.value}</span>
            </li>
          );
        })}
      </ul>
    </details>
  );
}

const POLL_MS = 5000;
/** Фото уходит картинкой, всё прочее — документом (правила — core/storage/upload). */
const PHOTO_TYPES = ["image/jpeg", "image/png"];
const ATTACH_ACCEPT = "image/jpeg,image/png,.pdf,.zip,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt";
type ChatAttachment = { kind: "photo" | "file"; key: string; name: string };

function label(c: Conversation): string {
  const name = [c.first_name, c.last_name].filter(Boolean).join(" ");
  return name || (c.username ? `@${c.username}` : c.user_key || `id ${c.telegram_id}`);
}

const CHANNEL: Record<string, string> = { instagram: "Instagram", whatsapp: "WhatsApp" };

/** Окно 24 часа Instagram/WhatsApp: сколько осталось или что закрыто. */
/** Переписка с ответа сервера; смещение часов фиксируется в момент ответа. */
function threadOf(
  prev: Thread,
  telegramId: number,
  r: {
    messages: ChatMessage[];
    hasMore: boolean;
    lastInboundAt: string | null;
    serverNow: string;
    waTemplate: string | null;
  },
): Thread {
  // Тот же диалог: уже подгруженную раньше переписку опрос не стирает.
  const same = prev.telegramId === telegramId;
  return {
    telegramId,
    messages: same ? mergeMessages(prev.messages, r.messages) : r.messages,
    hasMore: same ? prev.hasMore : r.hasMore,
    lastInboundAt: r.lastInboundAt,
    waTemplate: r.waTemplate,
    clockOffset: serverClockOffset(r.serverNow, Date.now()),
  };
}

type Thread = {
  telegramId: number | null;
  messages: ChatMessage[];
  /** Есть ли переписка раньше первого показанного сообщения. */
  hasMore: boolean;
  lastInboundAt: string | null;
  /** Имя шаблона WhatsApp для ответа вне окна; null — не задан. */
  waTemplate: string | null;
  /** Разница часов сервера и браузера на момент ответа сервера. */
  clockOffset: number;
};

function WindowBadge({ t, w }: { t: AdminT; w: ReplyWindow }) {
  if (w.state === "closed")
    return (
      <span className="mt-0.5 block">
        <Badge tone="warn">{t("chat.windowClosed")}</Badge>
      </span>
    );
  const { h, m } = windowLeftParts(w.leftMs);
  return (
    <span className="mt-0.5 block">
      <Badge tone={w.leftMs < 2 * 3_600_000 ? "warn" : "ok"}>
        {t("chat.windowOpen", { h, m })}
      </Badge>
    </span>
  );
}

function channelOf(c: Conversation): string | null {
  return CHANNEL[c.platform] ?? null;
}

type InvoiceModes = Awaited<ReturnType<typeof chatInvoiceModesFn>>;

/** Режим счёта для диалога; пока режимы не загрузились — как раньше, кнопкой. */
function invoiceModeOf(modes: InvoiceModes | null, c: Conversation): string {
  if (!modes) return "channel";
  if (c.platform === "instagram") return modes.instagram;
  if (c.platform === "whatsapp") return modes.whatsapp;
  return modes.telegram;
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
    {
      const m = await chatMessagesFn({ data: { telegramId: selectedId } });
      setThread((p) => threadOf(p, selectedId, m));
    }
  });

  return (
    <>
      <PageTitle title={t("chat.title")} subtitle={t("chat.subtitle")} />
      <ErrorBox
        error={
          loadError ??
          toggle.error ??
          send.error ??
          attach.error ??
          setMeta.error ??
          resumeBot.error
        }
      />
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
      <div className="card grid h-[calc(100vh-14rem)] min-h-[28rem] grid-cols-1 overflow-hidden md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <div className="overflow-y-auto border-b border-line md:border-r md:border-b-0">
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
          {hits === null && hasMore && (
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
        <div className="flex min-h-0 flex-col lg:flex-row">
          {selected === null ? (
            <p className="m-auto text-sm text-muted">{t("chat.pickDialog")}</p>
          ) : (
            <>
              <CustomerPanelView
                key={selected.telegram_id}
                t={t}
                loc={loc}
                telegramId={selected.telegram_id}
                canOpenCard={roleAllows(shop.role, CONTACTS_MIN_ROLE)}
                canWrite={canWrite}
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
                      <span className="block text-xs text-muted">
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
                  </span>
                  {canWrite && (
                    <span className="flex flex-wrap items-center justify-end gap-2">
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
                    </span>
                  )}
                </div>
                <div
                  ref={threadRef}
                  className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-4"
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

type PanelData = Awaited<ReturnType<typeof chatCustomerPanelFn>>;

/**
 * Боковая панель диалога: что продавцу нужно знать о покупателе, пока он отвечает.
 * Без контактов; ссылка на карточку (в ней телефон и почта) — только ролям с доступом к контактам.
 * На узком экране панель — полоса над перепиской.
 */
function CustomerPanelView({
  t,
  loc,
  telegramId,
  canOpenCard,
  canWrite,
}: {
  t: AdminT;
  loc: string;
  telegramId: number;
  canOpenCard: boolean;
  canWrite: boolean;
}) {
  const [data, setData] = useState<PanelData | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    const load = () =>
      chatCustomerPanelFn({ data: { telegramId } }).then(
        (r) => {
          if (alive) {
            setData(r);
            setFailed(false);
          }
        },
        () => alive && setFailed(true),
      );
    void load();
    const timer = setInterval(() => void load(), 30_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [telegramId]);
  // Теги и заметка: правка на месте, запись по версии (та же функция, что в карточке покупателя).
  const [tags, setTags] = useState("");
  const [note, setNote] = useState("");
  const [version, setVersion] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [noteConflict, setNoteConflict] = useState(false);
  const [noteSaved, setNoteSaved] = useState(false);
  // Опрос панели не затирает то, что продавец печатает: чужая правка подтянется, пока он не начал.
  useEffect(() => {
    if (!data || dirty) return;
    // Ответ опроса, ушедший до нашей записи, старее того, что уже на экране: не откатываем.
    if (version && (!data.sellerVersion || Date.parse(data.sellerVersion) < Date.parse(version)))
      return;
    setTags(data.seller.tags.join(", "));
    setNote(data.seller.note);
    setVersion(data.sellerVersion);
  }, [data, dirty, version]);
  const saveNote = useAction(async () => {
    if (!data) return;
    setNoteSaved(false);
    setNoteConflict(false);
    const r = await saveCustomerNoteFn({
      data: { key: data.userKey, tags: tags.split(",").map((x) => x.trim()), note, version },
    });
    setVersion(r.version);
    setTags(r.note.tags.join(", "));
    setNote(r.note.note);
    setData((d) => (d ? { ...d, seller: r.note, sellerVersion: r.version } : d));
    setDirty(false);
    if (r.saved) setNoteSaved(true);
    else setNoteConflict(true);
  });
  const spent = data
    ? Object.entries(data.stats.totals)
        .map(([cur, sum]) => formatMoney(sum, cur))
        .join(" + ")
    : "";
  return (
    <aside
      aria-label={t("chat.panelTitle")}
      className="max-h-40 shrink-0 overflow-y-auto border-b border-line p-3 text-sm lg:max-h-none lg:w-64 lg:border-b-0 lg:border-l lg:order-last"
    >
      <p className="mb-2 text-xs font-medium tracking-wide text-muted uppercase">
        {t("chat.panelTitle")}
      </p>
      {failed && !data ? (
        <p className="text-xs text-muted">{t("chat.panelNone")}</p>
      ) : data === undefined ? null : data === null ? (
        <p className="text-xs text-muted">{t("chat.panelNone")}</p>
      ) : (
        <div className="space-y-3">
          <dl className="space-y-1">
            <div className="flex justify-between gap-2">
              <dt className="text-muted">{t("chat.panelPoints")}</dt>
              <dd className="tabular-nums">{data.points}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted">{t("chat.panelSpent")}</dt>
              <dd className="text-right tabular-nums">{spent || "—"}</dd>
            </div>
          </dl>
          <div>
            <p className="mb-1 text-xs text-muted">{t("chat.panelOrders")}</p>
            {data.orders.length === 0 ? (
              <p className="text-xs text-muted">{t("chat.panelNoOrders")}</p>
            ) : (
              <ul className="space-y-1.5">
                {data.orders.map((o) => (
                  <li key={o.id}>
                    <Link
                      to="/admin/orders/$id"
                      params={{ id: String(o.id) }}
                      className="flex flex-wrap items-center justify-between gap-x-2 hover:text-accent"
                    >
                      <span>#{o.no}</span>
                      <span className="tabular-nums">{formatMoney(o.total, o.currency)}</span>
                      <span className="w-full text-xs text-muted">
                        <OrderStatus status={o.status} /> ·{" "}
                        {new Date(o.createdAt).toLocaleDateString(loc)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {data.tickets.length > 0 && (
            <div>
              <p className="mb-1 text-xs text-muted">{t("chat.panelTickets")}</p>
              <ul className="space-y-1">
                {data.tickets.map((x) => (
                  <li key={x.number}>
                    <Link to="/admin/tickets" className="block truncate hover:text-accent">
                      #{x.number} {x.subject}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div>
            <p className="mb-1 text-xs text-muted">{t("customer.sellerTitle")}</p>
            <ErrorBox error={saveNote.error} />
            {noteConflict && <p className="mb-1 text-xs text-warn">{t("customer.noteConflict")}</p>}
            <input
              className="input mb-1 w-full text-xs"
              aria-label={t("customer.tags")}
              placeholder={t("customer.tags")}
              value={tags}
              disabled={!canWrite}
              onChange={(e) => {
                setTags(e.target.value);
                setDirty(true);
                setNoteSaved(false);
              }}
            />
            <textarea
              className="input min-h-16 w-full text-xs"
              aria-label={t("customer.note")}
              placeholder={t("customer.note")}
              value={note}
              maxLength={2000}
              disabled={!canWrite}
              onChange={(e) => {
                setNote(e.target.value);
                setDirty(true);
                setNoteSaved(false);
              }}
            />
            {canWrite && (
              <div className="mt-1 flex items-center justify-end gap-2">
                {noteSaved && <span className="text-xs text-muted">{t("customer.saved")}</span>}
                <button
                  type="button"
                  className="btn-secondary text-xs"
                  disabled={saveNote.busy || !dirty}
                  onClick={() => void saveNote.run().catch(() => {})}
                >
                  {t("customer.save")}
                </button>
              </div>
            )}
          </div>
          {canOpenCard && (
            <Link
              to="/admin/customers/$key"
              params={{ key: data.userKey }}
              className="btn-secondary block text-center text-xs"
            >
              {t("chat.panelCard")}
            </Link>
          )}
        </div>
      )}
    </aside>
  );
}

const CHANNELS = [
  ["all", "chat.chAll"],
  ["telegram", "Telegram"],
  ["instagram", "Instagram"],
  ["whatsapp", "WhatsApp"],
] as const;

function InboxFilters({
  t,
  filter,
  counts,
  search,
  onSearch,
  onChange,
}: {
  t: AdminT;
  filter: InboxFilter;
  counts: { open: number; mine: number; unassigned: number; unread: number };
  search: string;
  onSearch: (q: string) => void;
  onChange: (f: InboxFilter) => void;
}) {
  const tab = (active: boolean) =>
    `rounded-md px-3 py-1 text-sm ${active ? "bg-surface-2 font-medium" : "text-muted hover:bg-surface-2/60"}`;
  const statuses = [
    ["open", `${t("chat.fOpen")} · ${counts.open}`],
    ["closed", t("chat.fClosed")],
    ["all", t("chat.fAll")],
  ] as const;
  const whos = [
    ["all", t("chat.wAll")],
    ["mine", `${t("chat.wMine")} · ${counts.mine}`],
    ["none", `${t("chat.wNone")} · ${counts.unassigned}`],
  ] as const;
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <div className="flex gap-1">
        {statuses.map(([v, label]) => (
          <button
            key={v}
            type="button"
            className={tab(filter.status === v)}
            onClick={() => onChange({ ...filter, status: v })}
          >
            {label}
          </button>
        ))}
      </div>
      <button
        type="button"
        aria-pressed={Boolean(filter.unread)}
        className={tab(Boolean(filter.unread))}
        onClick={() => onChange({ ...filter, unread: !filter.unread })}
      >
        {`${t("chat.fUnread")} · ${counts.unread}`}
      </button>
      <input
        type="search"
        className="input h-8 w-48 py-0 text-sm"
        value={search}
        placeholder={t("chat.search")}
        aria-label={t("chat.search")}
        onChange={(e) => onSearch(e.target.value)}
      />
      <select
        className="input h-8 w-auto py-0 text-sm"
        value={filter.who}
        onChange={(e) => onChange({ ...filter, who: e.target.value as InboxFilter["who"] })}
      >
        {whos.map(([v, label]) => (
          <option key={v} value={v}>
            {label}
          </option>
        ))}
      </select>
      <select
        className="input h-8 w-auto py-0 text-sm"
        value={filter.channel}
        onChange={(e) => onChange({ ...filter, channel: e.target.value as InboxFilter["channel"] })}
      >
        {CHANNELS.map(([v, label]) => (
          <option key={v} value={v}>
            {v === "all" ? t(label as "chat.chAll") : label}
          </option>
        ))}
      </select>
    </div>
  );
}

type InvoiceProduct = Awaited<ReturnType<typeof invoiceProductsFn>>[number];
type InvoiceLine = { product: InvoiceProduct; variantId: string | null; quantity: number };

/**
 * «Выставить счёт»: продавец собирает позиции, покупатель получает их одним
 * сообщением с кнопкой «Оформить заказ» (core/cart/seller-cart). Цены здесь —
 * базовые; итог по стране покупателя считает сервер и пишет в ответе. Товары
 * ищутся по названию: каталог крупного магазина целиком в форму не грузим.
 */
function InvoicePanel({
  t,
  link,
  telegramId,
  onClose,
  onSent,
}: {
  t: AdminT;
  /** Instagram/WhatsApp без оформления в канале: счёт — ссылкой на страницу заказа на сайте. */
  link: boolean;
  telegramId: number;
  onClose: () => void;
  onSent: () => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<InvoiceProduct[] | null>(null);
  const [lines, setLines] = useState<InvoiceLine[]>([]);
  const [cartCount, setCartCount] = useState(0);
  const [append, setAppend] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const search = useAction(async (q: string) => setFound(await invoiceProductsFn({ data: { q } })));
  const loadCart = useAction(async () =>
    setCartCount((await invoiceCartFn({ data: { telegramId } })).count),
  );
  useEffect(() => {
    void loadCart.run().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [telegramId]);
  useEffect(() => {
    const timer = setTimeout(() => void search.run(query).catch(() => {}), 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);
  const add = (p: InvoiceProduct) => {
    setLines((ls) => [...ls, { product: p, variantId: p.variants[0]?.id ?? null, quantity: 1 }]);
    setDone(null);
  };
  const patch = (i: number, v: Partial<InvoiceLine>) =>
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...v } : l)));
  const send = useAction(async () => {
    const r = await chatInvoiceFn({
      data: {
        telegramId,
        append,
        items: lines.map((l) => ({
          productId: l.product.id,
          variantId: l.variantId,
          quantity: l.quantity,
        })),
      },
    });
    const total = `${r.total.toLocaleString()} ${r.currency}`;
    setDone(
      r.orderNo != null
        ? t("chat.invoiceSentLink", { no: r.orderNo, total })
        : t("chat.invoiceSent", { total }),
    );
    setLines([]);
    await loadCart.run().catch(() => {});
    await onSent();
  });
  return (
    <div className="max-h-[50%] overflow-y-auto border-t border-line p-3">
      <ErrorBox error={search.error ?? loadCart.error ?? send.error} />
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-sm font-medium">{t("chat.invoice")}</p>
        <button type="button" className="btn-secondary text-xs" onClick={onClose}>
          {t("chat.invoiceClose")}
        </button>
      </div>
      <p className="mb-2 text-xs text-muted">
        {link ? t("chat.invoiceHintLink") : t("chat.invoiceHint")}
      </p>
      {cartCount > 0 && (
        <div className="mb-2 rounded-md bg-surface-2 p-2 text-xs">
          <p>
            {append
              ? t("chat.invoiceCartAppend", { n: cartCount })
              : t("chat.invoiceCartReplace", { n: cartCount })}
          </p>
          <label className="mt-1 flex items-center gap-2">
            <input type="checkbox" checked={append} onChange={(e) => setAppend(e.target.checked)} />
            {t("chat.invoiceAppend")}
          </label>
        </div>
      )}
      <div className="flex flex-col gap-2">
        {lines.map((l, i) => {
          const p = l.product;
          return (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-sm">{p.name}</span>
              {p.variants.length > 0 && (
                <select
                  className="input h-8 w-auto py-0 text-xs"
                  aria-label={t("chat.invoiceVariant")}
                  value={l.variantId ?? ""}
                  onChange={(e) => patch(i, { variantId: e.target.value })}
                >
                  {p.variants.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name} · {v.price.toLocaleString()} {p.currency}
                    </option>
                  ))}
                </select>
              )}
              {p.physical ? (
                <input
                  type="number"
                  className="input h-8 w-20 py-0 text-xs"
                  aria-label={t("chat.invoiceQty")}
                  min={1}
                  max={99}
                  value={l.quantity}
                  onChange={(e) =>
                    patch(i, { quantity: Math.max(1, Math.min(99, Number(e.target.value) || 1)) })
                  }
                />
              ) : (
                p.variants.length === 0 && (
                  <span className="text-xs text-muted">
                    {p.price.toLocaleString()} {p.currency}
                  </span>
                )
              )}
              <button
                type="button"
                className="btn-secondary text-xs"
                onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}
              >
                {t("chat.invoiceRemove")}
              </button>
            </div>
          );
        })}
        <input
          className="input h-8 py-0 text-xs"
          placeholder={t("chat.invoiceSearch")}
          aria-label={t("chat.invoiceSearch")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {found && found.length === 0 && (
          <p className="text-xs text-muted">{t("chat.invoiceNothing")}</p>
        )}
        {found && found.length > 0 && (
          <div className="flex max-h-40 flex-col overflow-y-auto rounded-md border border-line">
            {found.map((p) => (
              <button
                key={p.id}
                type="button"
                className="flex justify-between gap-2 border-b border-line px-2 py-1 text-left text-xs last:border-b-0 hover:bg-surface-2"
                onClick={() => add(p)}
              >
                <span className="truncate">+ {p.name}</span>
                {p.variants.length === 0 && (
                  <span className="shrink-0 text-muted">
                    {p.price.toLocaleString()} {p.currency}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="text-xs text-muted">{done}</span>
        <button
          type="button"
          className="btn-primary text-xs"
          disabled={lines.length === 0 || send.busy}
          onClick={() => void send.run().catch(() => {})}
        >
          {t("chat.invoiceSend")}
        </button>
      </div>
    </div>
  );
}

/** Через сколько минут без ответа напомнить продавцу в Telegram (крон, core/chat/unanswered). */
function UnansweredAlert({
  t,
  initial,
  initialEscalate,
  canWrite,
}: {
  t: AdminT;
  initial: number;
  initialEscalate: boolean;
  canWrite: boolean;
}) {
  const [minutes, setMinutes] = useState(initial);
  const [escalate, setEscalate] = useState(initialEscalate);
  const save = useAction(async (m: number, e: boolean) => {
    const r = await chatUnansweredSaveFn({ data: { minutes: m, escalate: e } });
    setMinutes(r.minutes);
    setEscalate(e);
  });
  const option = (m: number) =>
    m === 0
      ? t("chat.unansweredOff")
      : m < 60
        ? t("chat.unansweredMin", { n: m })
        : t("chat.unansweredHours", { n: m / 60 });
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
      <label htmlFor="unanswered" className="text-muted">
        {t("chat.unanswered")}
      </label>
      <select
        id="unanswered"
        className="input w-auto"
        value={minutes}
        disabled={!canWrite || save.busy}
        onChange={(e) => void save.run(Number(e.target.value), escalate).catch(() => {})}
      >
        {UNANSWERED_OPTIONS.map((m) => (
          <option key={m} value={m}>
            {option(m)}
          </option>
        ))}
      </select>
      <span className="text-xs text-muted">{t("chat.unansweredHint")}</span>
      {minutes > 0 && (
        <label className="flex basis-full items-center gap-2 text-muted">
          <input
            type="checkbox"
            checked={escalate}
            disabled={!canWrite || save.busy}
            onChange={(e) => void save.run(minutes, e.target.checked).catch(() => {})}
          />
          {t("chat.unansweredEscalate")}
        </label>
      )}
      <ErrorBox error={save.error} />
    </div>
  );
}

function QuickReplies({
  t,
  replies,
  editing,
  onEdit,
  onSaved,
  onPick,
}: {
  t: AdminT;
  replies: QuickReply[];
  editing: boolean;
  onEdit: (v: boolean) => void;
  onSaved: (r: QuickReply[]) => void;
  onPick: (r: QuickReply) => void | Promise<void>;
}) {
  const [draft, setDraft] = useState<QuickReply[]>(replies);
  const save = useAction(async () => {
    const r = await quickRepliesSaveFn({ data: { replies: draft } });
    onSaved(r.replies);
    onEdit(false);
  });
  if (editing)
    return (
      <div className="max-h-[50%] overflow-y-auto border-t border-line p-3">
        <ErrorBox error={save.error} />
        <p className="mb-2 text-xs text-muted">{t("chat.quickText")}</p>
        <div className="flex flex-col gap-2">
          {draft.map((r, i) => (
            <div key={i} className="flex flex-col gap-1 rounded-md border border-line p-2">
              <div className="flex gap-2">
                <input
                  className="input flex-1"
                  placeholder={t("chat.quickTitle")}
                  value={r.title}
                  maxLength={60}
                  onChange={(e) =>
                    setDraft(draft.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))
                  }
                />
                <button
                  type="button"
                  className="btn-secondary text-xs"
                  onClick={() => setDraft(draft.filter((_, j) => j !== i))}
                >
                  {t("chat.quickRemove")}
                </button>
              </div>
              <textarea
                className="input"
                rows={2}
                maxLength={2000}
                value={r.text}
                onChange={(e) =>
                  setDraft(draft.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))
                }
              />
            </div>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-secondary text-xs"
            disabled={draft.length >= 30}
            onClick={() => setDraft([...draft, { title: "", text: "" }])}
          >
            {t("chat.quickAdd")}
          </button>
          <button
            type="button"
            className="btn-primary text-xs"
            disabled={save.busy}
            onClick={() => void save.run().catch(() => {})}
          >
            {t("chat.quickSave")}
          </button>
          <button
            type="button"
            className="btn-secondary text-xs"
            onClick={() => {
              setDraft(replies);
              onEdit(false);
            }}
          >
            {t("chat.quickCancel")}
          </button>
        </div>
      </div>
    );
  return (
    <div className="flex items-center gap-2 overflow-x-auto border-t border-line px-3 py-2">
      <span className="shrink-0 text-xs text-muted">{t("chat.quick")}:</span>
      {replies.length === 0 && (
        <span className="truncate text-xs text-muted">{t("chat.quickEmpty")}</span>
      )}
      {replies.map((r, i) => (
        <button
          key={i}
          type="button"
          title={r.text}
          className="badge shrink-0 cursor-pointer hover:bg-surface-2"
          onClick={() => onPick(r)}
        >
          {r.title}
        </button>
      ))}
      <button
        type="button"
        className="ml-auto shrink-0 text-xs text-accent hover:underline"
        onClick={() => {
          setDraft(replies.length ? replies : [{ title: "", text: "" }]);
          onEdit(true);
        }}
      >
        {t("chat.quickEdit")}
      </button>
    </div>
  );
}
