import { useEffect, useState } from "react";
import {
  communityAuthorsFn,
  communityDmPrefsFn,
  communityDmThreadFn,
  communityInboxFn,
  sendCommunityDmFn,
  setCommunityDmBlockedFn,
  setCommunityDmOffFn,
} from "@/app/admin/community-dm.functions";
import type { AdminT } from "@/app/i18n/admin";
import { Card, Empty, ErrorBox, useAction } from "@/app/ui";

type Inbox = Extract<Awaited<ReturnType<typeof communityInboxFn>>, { soon: false }>;
type Thread = Extract<Awaited<ReturnType<typeof communityDmThreadFn>>, { soon: false }>;

/** Личные сообщения авторов: переписки, список авторов, приём и запреты. Без таблицы не рисуется. */
export function CommunityDm({ canWrite, loc, t }: { canWrite: boolean; loc: string; t: AdminT }) {
  const [inbox, setInbox] = useState<Inbox["conversations"]>([]);
  const [authors, setAuthors] = useState<Awaited<ReturnType<typeof communityAuthorsFn>>["authors"]>(
    [],
  );
  const [prefs, setPrefs] = useState<Awaited<ReturnType<typeof communityDmPrefsFn>> | null>(null);
  const [open, setOpen] = useState<{ id: string; name: string | null } | null>(null);
  const load = useAction(async () => {
    const [i, a, p] = await Promise.all([
      communityInboxFn(),
      communityAuthorsFn(),
      communityDmPrefsFn(),
    ]);
    if (!i.soon) setInbox(i.conversations);
    setAuthors(a.authors);
    setPrefs(p);
  });
  useEffect(() => {
    void load.run().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const setOff = useAction(async (off: boolean) => {
    await setCommunityDmOffFn({ data: { off } });
    await load.run();
  });
  const unblock = useAction(async (botId: string) => {
    await setCommunityDmBlockedFn({ data: { botId, blocked: false } });
    await load.run();
  });
  if (open)
    return (
      <DmThread
        withId={open.id}
        name={open.name}
        canWrite={canWrite}
        loc={loc}
        t={t}
        onBack={() => {
          setOpen(null);
          void load.run().catch(() => {});
        }}
      />
    );
  return (
    <div className="space-y-4">
      <ErrorBox error={load.error ?? setOff.error ?? unblock.error} />
      {canWrite && prefs && (
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            checked={prefs.off}
            disabled={setOff.busy}
            onChange={(e) => void setOff.run(e.target.checked).catch(() => {})}
          />
          <span>
            {t("community.dm.off")}
            <span className="block text-xs text-muted">{t("community.dm.offHint")}</span>
          </span>
        </label>
      )}
      {inbox.length === 0 ? (
        <Empty>{t("community.dm.empty")}</Empty>
      ) : (
        <ul className="space-y-2">
          {inbox.map((c) => (
            <li key={c.with}>
              <button
                className="card block w-full p-3 text-left"
                onClick={() => setOpen({ id: c.with, name: c.name })}
              >
                <div className="flex items-center gap-2 font-medium">
                  {c.name ?? t("community.anon")}
                  {c.unread > 0 && <span className="badge">{c.unread}</span>}
                </div>
                <div className="mt-1 line-clamp-1 text-sm text-muted">
                  {c.lastFromMe ? t("community.dm.fromYou") : ""}
                  {c.last}
                </div>
                <div className="mt-1 text-xs text-muted">
                  {new Date(c.lastAt).toLocaleDateString(loc)}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
      <Card title={t("community.dm.authors")}>
        {authors.length === 0 ? (
          <p className="text-sm text-muted">{t("community.dm.noAuthors")}</p>
        ) : (
          <ul className="space-y-2">
            {authors.map((a) => (
              <li key={a.id} className="flex items-start justify-between gap-3">
                <div className="text-sm">
                  <div className="font-medium">{a.name}</div>
                  <div className="text-xs text-muted">
                    {[a.niche, a.city].filter(Boolean).join(" · ")}
                  </div>
                  {a.about && <div className="mt-1 text-xs">{a.about}</div>}
                </div>
                {canWrite && (
                  <button
                    className="btn-secondary shrink-0"
                    onClick={() => setOpen({ id: a.id, name: a.name })}
                  >
                    {t("community.dm.write")}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
      {prefs && prefs.blocked.length > 0 && (
        <Card title={t("community.dm.blockedTitle")}>
          <ul className="space-y-1 text-sm">
            {prefs.blocked.map((b) => (
              <li key={b.id} className="flex items-center justify-between gap-3">
                <span>{b.name ?? t("community.anon")}</span>
                {canWrite && (
                  <button
                    className="btn-ghost"
                    disabled={unblock.busy}
                    onClick={() => void unblock.run(b.id).catch(() => {})}
                  >
                    {t("community.dm.unblock")}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function DmThread({
  withId,
  name,
  canWrite,
  loc,
  t,
  onBack,
}: {
  withId: string;
  name: string | null;
  canWrite: boolean;
  loc: string;
  t: AdminT;
  onBack: () => void;
}) {
  const [messages, setMessages] = useState<Thread["messages"]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [canReply, setCanReply] = useState(true);
  const [text, setText] = useState("");
  const load = useAction(async (offset: number) => {
    const r = await communityDmThreadFn({ data: { withId, offset } });
    if (r.soon) return;
    setCanReply(r.canReply);
    setNext(r.next);
    // Страницы идут от свежих к старым: старая страница ставится перед уже показанными.
    setMessages((m) => (offset === 0 ? r.messages : [...r.messages, ...m]));
  });
  useEffect(() => {
    void load.run(0).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [withId]);
  const send = useAction(async () => {
    await sendCommunityDmFn({ data: { toId: withId, body: text } });
    setText("");
    await load.run(0);
  });
  const block = useAction(async () => {
    await setCommunityDmBlockedFn({ data: { botId: withId, blocked: true } });
    onBack();
  });
  return (
    <div>
      <button className="btn-ghost mb-3" onClick={onBack}>
        {t("community.back")}
      </button>
      <h2 className="mb-3 font-medium">{name ?? t("community.anon")}</h2>
      <ErrorBox error={load.error ?? send.error ?? block.error} />
      {next !== null && (
        <button
          className="btn-secondary mb-3"
          disabled={load.busy}
          onClick={() => void load.run(next).catch(() => {})}
        >
          {t("community.more")}
        </button>
      )}
      <ul className="space-y-2">
        {messages.map((m) => (
          <li key={m.id} className={`card p-3 ${m.mine ? "ml-8" : "mr-8"}`}>
            <div className="whitespace-pre-wrap text-sm">{m.body}</div>
            <div className="mt-1 text-xs text-muted">{new Date(m.at).toLocaleString(loc)}</div>
          </li>
        ))}
      </ul>
      {canWrite && canReply && (
        <form
          className="mt-4 space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            void send.run().catch(() => {});
          }}
        >
          <textarea
            className="input min-h-20"
            maxLength={2000}
            placeholder={t("community.dm.placeholder")}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <button className="btn-primary" disabled={send.busy}>
            {t("community.dm.send")}
          </button>
        </form>
      )}
      {!canReply && <p className="mt-3 text-sm text-muted">{t("community.dm.cantReply")}</p>}
      {canWrite && (
        <button
          className="btn-ghost mt-3 text-danger"
          disabled={block.busy}
          onClick={() => void block.run().catch(() => {})}
        >
          {t("community.dm.block")}
        </button>
      )}
    </div>
  );
}
