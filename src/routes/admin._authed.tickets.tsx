import { HelpTip } from "@/app/admin/help-panel";
import { canEdit } from "@/core/auth/roles";
import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import {
  ticketOverdueSaveFn,
  ticketReplyFn,
  ticketsFn,
  updateTicketFn,
} from "@/app/admin/helpdesk.functions";
import type { TeamMember } from "@/app/admin/helpdesk.server";
import { quickReplyFillFn } from "@/app/admin/chat.functions";
import { adminT, intlLocale, type AdminT } from "@/app/i18n/admin";
import { Badge, Empty, ErrorBox, PageTitle, useAction } from "@/app/ui";
import { OVERDUE_OPTIONS } from "@/core/helpdesk/overdue";
import { historyLine, TICKET_FILTERS, type TicketFilter } from "@/core/helpdesk/view";
import type { Ticket, TicketStatus } from "@/core/helpdesk/tickets";

export const Route = createFileRoute("/admin/_authed/tickets")({
  validateSearch: z.object({ status: z.enum(TICKET_FILTERS).optional() }),
  beforeLoad: ({ context }) => {
    if (!context.shop.modules.helpdesk) throw redirect({ to: "/admin" });
  },
  loaderDeps: ({ search }) => ({ status: search.status ?? "open" }),
  loader: ({ deps }) => ticketsFn({ data: { status: deps.status === "all" ? null : deps.status } }),
  component: TicketsPage,
});

const TONE: Record<TicketStatus, "accent" | "warn" | "neutral"> = {
  open: "accent",
  waiting: "warn",
  closed: "neutral",
};
const CHANNEL: Record<string, string> = {
  telegram: "Telegram",
  instagram: "Instagram",
  whatsapp: "WhatsApp",
};

function TicketsPage() {
  const data = Route.useLoaderData();
  const { shop } = Route.useRouteContext();
  const t = adminT(shop.locale);
  const current: TicketFilter = Route.useSearch().status ?? "open";
  const navigate = useNavigate();
  const [tickets, setTickets] = useState(data.tickets);
  const [seen, setSeen] = useState(data.tickets);
  // Загрузчик отдал новый список (сменили фильтр) — берём его.
  if (seen !== data.tickets) {
    setSeen(data.tickets);
    setTickets(data.tickets);
  }
  const canWrite = canEdit(shop.role);
  const fmt = (iso: string) =>
    new Date(iso).toLocaleString(intlLocale(shop.locale), {
      dateStyle: "short",
      timeStyle: "short",
    });
  return (
    <>
      <PageTitle title={t("tickets.title")} subtitle={t("tickets.subtitle")} />
      <div className="mb-4 flex flex-wrap gap-2">
        {TICKET_FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            className={`badge px-3 py-1.5 ${current === f ? "border-accent bg-accent/10 text-accent" : ""}`}
            onClick={() =>
              void navigate({
                to: "/admin/tickets",
                search: { status: f === "open" ? undefined : f },
              })
            }
          >
            {t(`tickets.filter.${f}`)}
            {f === "open" && data.openCount > 0 ? ` · ${data.openCount}` : ""}
          </button>
        ))}
      </div>
      <OverdueSetting t={t} initial={data.overdueHours} canWrite={canWrite} />
      {data.ratings.count > 0 && (
        <div className="card mb-4 space-y-3 p-4">
          <p className="font-medium">
            {t("tickets.rating.avg", {
              avg: String(data.ratings.average),
              count: String(data.ratings.count),
            })}
          </p>
          {data.ratings.low.length > 0 && (
            <div>
              <h3 className="mb-2 text-sm font-medium">
                {t("tickets.rating.low", { count: String(data.ratings.lowCount) })}
              </h3>
              <ul className="space-y-1 text-sm">
                {data.ratings.low.map((tk) => (
                  <li key={tk.id}>
                    <Link to="/admin/chat" search={{ c: tk.telegramId }} className="underline">
                      #{tk.number} · {"⭐".repeat(tk.rating ?? 0)}
                    </Link>{" "}
                    <span className="text-muted">
                      {tk.customerName ?? t("tickets.buyer")} — {tk.subject.slice(0, 80)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      {tickets.length === 0 ? (
        <Empty>{t("tickets.empty")}</Empty>
      ) : (
        <div className="space-y-3">
          {tickets.map((tk) => (
            <TicketCard
              key={tk.id}
              ticket={tk}
              overdue={data.overdueIds.includes(tk.id)}
              quickReplies={data.quickReplies}
              team={data.team}
              t={t}
              fmt={fmt}
              canWrite={canWrite}
              onChange={(next) =>
                setTickets((all) => all.map((x) => (x.id === next.id ? next : x)))
              }
            />
          ))}
        </div>
      )}
    </>
  );
}

/** Порог «обращение просрочено» (крон, core/helpdesk/overdue). */
function OverdueSetting({
  t,
  initial,
  canWrite,
}: {
  t: AdminT;
  initial: number;
  canWrite: boolean;
}) {
  const [hours, setHours] = useState(initial);
  const save = useAction(async (h: number) => {
    const r = await ticketOverdueSaveFn({ data: { hours: h } });
    setHours(r.hours);
  });
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
      <label htmlFor="overdue" className="text-muted">
        {t("tickets.overdue.label")}
      </label>
      <HelpTip article="tickets" anchor="overdue" />
      <select
        id="overdue"
        className="input w-auto"
        value={hours}
        disabled={!canWrite || save.busy}
        onChange={(e) => void save.run(Number(e.target.value)).catch(() => {})}
      >
        {OVERDUE_OPTIONS.map((h) => (
          <option key={h} value={h}>
            {h === 0 ? t("tickets.overdue.off") : t("tickets.overdue.hours", { n: String(h) })}
          </option>
        ))}
      </select>
      <span className="text-xs text-muted">{t("tickets.overdue.hint")}</span>
      <ErrorBox error={save.error} />
    </div>
  );
}

/**
 * Ответ покупателю из обращения: быстрые ответы (те же, что в «Чате», с
 * подстановкой имени, номера заказа и обращения) вставляют текст, продавец
 * правит и отправляет — в канал покупателя, как из «Чата».
 */
function ReplyBox({
  ticket,
  quickReplies,
  t,
}: {
  ticket: Ticket;
  quickReplies: { title: string; text: string }[];
  t: AdminT;
}) {
  const [text, setText] = useState("");
  const [draftId, setDraftId] = useState(() => crypto.randomUUID());
  const [sent, setSent] = useState(false);
  const pick = async (raw: string) => {
    const filled = await quickReplyFillFn({
      data: { telegramId: ticket.telegramId, text: raw, ticketNo: ticket.number },
    }).then(
      (x) => x.text,
      () => raw,
    );
    setText((cur) => (cur.trim() ? `${cur}\n` : "") + filled);
    setSent(false);
  };
  const send = useAction(async () => {
    await ticketReplyFn({ data: { id: ticket.id, text: text.trim(), draftId } });
    setText("");
    setDraftId(crypto.randomUUID());
    setSent(true);
  });
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium">{t("tickets.reply.title")}</h3>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-muted">{t("tickets.reply.quick")}:</span>
        {quickReplies.map((r, i) => (
          <button
            key={i}
            type="button"
            title={r.text}
            className="badge cursor-pointer hover:bg-surface-2"
            onClick={() => void pick(r.text)}
          >
            {r.title}
          </button>
        ))}
        <Link to="/admin/chat" className="text-muted underline">
          {t("tickets.reply.quickHint")}
        </Link>
      </div>
      <textarea
        className="input min-h-20 w-full"
        maxLength={4000}
        placeholder={t("tickets.reply.placeholder")}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setSent(false);
        }}
      />
      <button
        type="button"
        className="btn-primary"
        disabled={!text.trim() || send.busy}
        onClick={() => void send.run().catch(() => {})}
      >
        {t("tickets.reply.send")}
      </button>
      {sent && <p className="text-xs text-muted">{t("tickets.reply.sent")}</p>}
      <ErrorBox error={send.error} />
    </div>
  );
}

function TicketCard({
  ticket: tk,
  overdue,
  quickReplies,
  team,
  t,
  fmt,
  canWrite,
  onChange,
}: {
  ticket: Ticket;
  overdue: boolean;
  quickReplies: { title: string; text: string }[];
  team: TeamMember[];
  t: AdminT;
  fmt: (iso: string) => string;
  canWrite: boolean;
  onChange: (t: Ticket) => void;
}) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const save = useAction(
    async (patch: { status?: TicketStatus; assignee?: string | null; note?: string }) => {
      const { ticket } = await updateTicketFn({ data: { id: tk.id, ...patch } });
      onChange(ticket);
      if (patch.note) setNote("");
    },
  );
  const who = (u: string | null) => {
    if (!u) return t("tickets.nobody");
    const m = team.find((x) => x.username === u);
    return m?.name ? `${m.name} (${u})` : u;
  };
  return (
    <div className={`card p-4 ${overdue ? "border-warn" : ""}`}>
      <button
        type="button"
        className="flex w-full flex-wrap items-start justify-between gap-2 text-left"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 font-medium">
            <span>#{tk.number}</span>
            <Badge tone={TONE[tk.status]}>{t(`tickets.status.${tk.status}`)}</Badge>
            {overdue && <Badge tone="warn">⏳ {t("tickets.overdue.badge")}</Badge>}
            <span className="text-sm text-muted">{CHANNEL[tk.platform] ?? tk.platform}</span>
            {tk.rating !== null && (
              <span title={t("tickets.rating.title")}>{"⭐".repeat(tk.rating)}</span>
            )}
          </div>
          <p className="mt-1 line-clamp-2 break-words">{tk.subject}</p>
          <p className="mt-1 text-sm text-muted">
            {tk.customerName ?? t("tickets.buyer")} · {fmt(tk.createdAt)} · {who(tk.assignee)}
          </p>
        </div>
      </button>
      {open && (
        <div className="mt-4 space-y-4 border-t border-line pt-4">
          <div className="flex flex-wrap items-center gap-2">
            <HelpTip article="tickets" anchor="status" />
            {(["open", "waiting", "closed"] as const).map((s) => (
              <button
                key={s}
                type="button"
                className={tk.status === s ? "btn-primary" : "btn-secondary"}
                disabled={!canWrite || save.busy || tk.status === s}
                onClick={() => void save.run({ status: s }).catch(() => {})}
              >
                {t(`tickets.status.${s}`)}
              </button>
            ))}
            <Link to="/admin/chat" search={{ c: tk.telegramId }} className="btn-secondary ml-auto">
              {t("tickets.openChat")}
            </Link>
          </div>
          <label className="block text-sm">
            <span className="mb-1 flex items-center gap-1.5 text-muted">
              {t("tickets.assignee")}
              <HelpTip article="tickets" anchor="assignee" />
            </span>
            <select
              className="input w-full sm:w-72"
              value={tk.assignee ?? ""}
              disabled={!canWrite || save.busy}
              onChange={(e) => void save.run({ assignee: e.target.value || null }).catch(() => {})}
            >
              <option value="">{t("tickets.nobody")}</option>
              {team.map((m) => (
                <option key={m.username} value={m.username}>
                  {who(m.username)}
                </option>
              ))}
            </select>
          </label>
          {canWrite && tk.status !== "closed" && (
            <ReplyBox ticket={tk} quickReplies={quickReplies} t={t} />
          )}
          {canWrite && (
            <div className="space-y-2">
              <textarea
                className="input min-h-20 w-full"
                maxLength={1000}
                placeholder={t("tickets.notePlaceholder")}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
              <button
                type="button"
                className="btn-secondary"
                disabled={!note.trim() || save.busy}
                onClick={() => void save.run({ note }).catch(() => {})}
              >
                {t("tickets.addNote")}
              </button>
            </div>
          )}
          <ErrorBox error={save.error} />
          <div>
            <h3 className="mb-2 text-sm font-medium">{t("tickets.history")}</h3>
            <ul className="space-y-1 text-sm">
              {tk.history
                .slice()
                .reverse()
                .map((h, i) => (
                  <li key={i} className="break-words">
                    <span className="text-muted">{fmt(h.at)}</span> ·{" "}
                    {historyLine(h, (k, v) => t(k as never, v), who)}
                  </li>
                ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
