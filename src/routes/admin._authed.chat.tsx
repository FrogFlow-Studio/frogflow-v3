import { canEdit } from "@/core/auth/roles";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import {
  chatConnectFn,
  chatConversationsFn,
  chatInvoiceFn,
  chatMessagesFn,
  chatReplyFn,
  chatResumeBotFn,
  inboxSetFn,
  invoiceCartFn,
  invoiceProductsFn,
  quickRepliesSaveFn,
} from "@/app/admin/admin.functions";
import { adminT, intlLocale, type AdminT } from "@/app/i18n/admin";
import { Badge, Empty, ErrorBox, PageTitle, useAction } from "@/app/ui";
import type { ChatMessage, Conversation } from "@/core/chat/chat";
import { isIndefinite } from "@/core/consultant/pause";
import {
  fillQuickReply,
  filterInbox,
  inboxCounts,
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

const POLL_MS = 5000;

function label(c: Conversation): string {
  const name = [c.first_name, c.last_name].filter(Boolean).join(" ");
  return name || (c.username ? `@${c.username}` : c.user_key || `id ${c.telegram_id}`);
}

const CHANNEL: Record<string, string> = { instagram: "Instagram", whatsapp: "WhatsApp" };

function channelOf(c: Conversation): string | null {
  return CHANNEL[c.platform] ?? null;
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
  const [quickReplies, setQuickReplies] = useState<QuickReply[]>(initial.quickReplies);
  const [editingQuick, setEditingQuick] = useState(false);
  const [invoicing, setInvoicing] = useState(false);
  const [filter, setFilter] = useState<InboxFilter>({ status: "open", who: "all", channel: "all" });
  const canWrite = canEdit(shop.role);
  const me = initial.me;
  const visible = filterInbox(conversations, filter, me);
  const counts = inboxCounts(conversations, me);
  const assigneeName = (u: string | null) => {
    if (!u) return t("chat.nobody");
    const a = initial.assignees.find((x) => x.username === u);
    return a?.name ? `${a.name} (${u})` : u;
  };
  const [selectedId, setSelectedId] = useState<number | null>(Route.useSearch().c ?? null);
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
    setConversations((await chatConversationsFn()).conversations);
  });
  const resumeBot = useAction(async () => {
    if (!selected) return;
    await chatResumeBotFn({ data: { telegramId: selected.telegram_id } });
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
      <PageTitle title={t("chat.title")} subtitle={t("chat.subtitle")} />
      <ErrorBox
        error={loadError ?? toggle.error ?? send.error ?? setMeta.error ?? resumeBot.error}
      />
      <InboxFilters t={t} filter={filter} counts={counts} onChange={setFilter} />
      <div className="card grid h-[calc(100vh-14rem)] min-h-[28rem] grid-cols-1 overflow-hidden md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <div className="overflow-y-auto border-b border-line md:border-r md:border-b-0">
          {conversations.length === 0 ? (
            <Empty>{t("chat.empty")}</Empty>
          ) : visible.length === 0 ? (
            <Empty>{t("chat.emptyFiltered")}</Empty>
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
        </div>
        <div className="flex min-h-0 flex-col">
          {selected === null ? (
            <p className="m-auto text-sm text-muted">{t("chat.pickDialog")}</p>
          ) : (
            <>
              <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-2">
                <span className="text-sm font-medium">
                  {label(selected)}{" "}
                  <span className="text-xs text-muted">
                    {channelOf(selected) ??
                      (selected.username ? `@${selected.username}` : `id ${selected.telegram_id}`)}
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
                    <button
                      type="button"
                      className="btn-secondary text-xs"
                      onClick={() => setInvoicing((v) => !v)}
                    >
                      {t("chat.invoice")}
                    </button>
                    <button
                      type="button"
                      className={selected.active ? "btn-secondary text-xs" : "btn-primary text-xs"}
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
                {messages.map((m) => (
                  <div
                    key={m.id}
                    className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${BUBBLE[m.sender] ?? BUBBLE.bot}`}
                  >
                    {m.sender === "bot" && (
                      <p className="mb-1 text-[10px] tracking-wide text-muted uppercase">
                        {t("chat.botAuto")}
                      </p>
                    )}
                    <p className="whitespace-pre-wrap">{stripHtml(m.text)}</p>
                    <p className="mt-1 text-[10px] text-muted">
                      {new Date(m.created_at).toLocaleString(loc)}
                    </p>
                  </div>
                ))}
              </div>
              {canWrite && invoicing && (
                <InvoicePanel
                  key={selected.telegram_id}
                  t={t}
                  telegramId={selected.telegram_id}
                  onClose={() => setInvoicing(false)}
                  onSent={async () => {
                    setMessages(
                      await chatMessagesFn({ data: { telegramId: selected.telegram_id } }),
                    );
                    setConversations((await chatConversationsFn()).conversations);
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
                  onPick={(r) =>
                    setReply(
                      (cur) => (cur.trim() ? `${cur}\n` : "") + fillQuickReply(r.text, selected),
                    )
                  }
                />
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
                      selected.active ? t("chat.placeholderActive") : t("chat.placeholderInactive")
                    }
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.ctrlKey || e.metaKey))
                        void send.run().catch(() => {});
                    }}
                  />
                  <button className="btn-primary self-end" disabled={!reply.trim() || send.busy}>
                    {t("chat.send")}
                  </button>
                </form>
              )}
            </>
          )}
        </div>
      </div>
    </>
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
  onChange,
}: {
  t: AdminT;
  filter: InboxFilter;
  counts: { open: number; mine: number; unassigned: number };
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
  telegramId,
  onClose,
  onSent,
}: {
  t: AdminT;
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
    setDone(t("chat.invoiceSent", { total: `${r.total.toLocaleString()} ${r.currency}` }));
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
      <p className="mb-2 text-xs text-muted">{t("chat.invoiceHint")}</p>
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
  onPick: (r: QuickReply) => void;
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
