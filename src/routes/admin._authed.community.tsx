import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import {
  communityThreadFn,
  communityThreadsFn,
  createCommunityPostFn,
  createCommunityThreadFn,
  reportCommunityFn,
} from "@/app/admin/community.functions";
import { adminT, intlLocale, type AdminKey } from "@/app/i18n/admin";
import { CommunityDm } from "@/app/admin/community-dm";
import { communityUnreadFn } from "@/app/admin/community-dm.functions";
import { CommunityPromos } from "@/app/admin/community-promos";
import { jointReadyFn } from "@/app/admin/community-promos.functions";
import { Card, Empty, ErrorBox, Field, PageTitle, useAction } from "@/app/ui";
import { canEdit } from "@/core/auth/roles";
import { HelpTip } from "@/app/admin/help-panel";

export const Route = createFileRoute("/admin/_authed/community")({
  component: CommunityPage,
});

const SECTIONS = ["questions", "experience", "offers"] as const;
const TOPICS = ["packaging", "photo", "delivery", "contractors"] as const;
type Section = (typeof SECTIONS)[number];
type Topic = (typeof TOPICS)[number];
type List = Extract<Awaited<ReturnType<typeof communityThreadsFn>>, { soon: false }>;
type Item = List["threads"][number];
type Open = Extract<Awaited<ReturnType<typeof communityThreadFn>>, { soon: false }>;

function CommunityPage() {
  const { shop } = Route.useRouteContext();
  const t = adminT(shop.locale);
  const loc = intlLocale(shop.locale);
  const canWrite = canEdit(shop.role);
  const [section, setSection] = useState<Section>("questions");
  const [topic, setTopic] = useState<Topic | null>(null);
  const [search, setSearch] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [state, setState] = useState<"loading" | "soon" | "ready">("loading");
  const [openId, setOpenId] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const [view, setView] = useState<"topics" | "dm" | "promos">("topics");
  // Личные сообщения: вкладки нет, пока таблицы в базе нет (миграция 19-3).
  const [dm, setDm] = useState<{ ready: boolean; unread: number }>({ ready: false, unread: 0 });
  useEffect(() => {
    void communityUnreadFn()
      .then((r) => setDm(r.soon ? { ready: false, unread: 0 } : { ready: true, unread: r.unread }))
      .catch(() => {});
  }, []);
  // Совместные акции: вкладки нет, пока таблиц нет (миграция 19-4) или не включён модуль промокодов.
  const [promos, setPromos] = useState(false);
  useEffect(() => {
    void jointReadyFn()
      .then((r) => setPromos(r.ready))
      .catch(() => {});
  }, []);

  const load = useAction(
    async (q: { section: Section; topic: Topic | null; search: string; offset: number }) => {
      const r = await communityThreadsFn({
        data: {
          section: q.section,
          topic: q.section === "offers" ? q.topic : null,
          search: q.search,
          offset: q.offset,
        },
      });
      if (r.soon) return setState("soon");
      setState("ready");
      setItems((prev) => (q.offset === 0 ? r.threads : [...prev, ...r.threads]));
      setNext(r.next);
    },
  );
  const reload = useCallback(
    () => void load.run({ section, topic, search, offset: 0 }).catch(() => {}),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [section, topic],
  );
  useEffect(reload, [reload]);

  return (
    <>
      <PageTitle title={t("community.title")} />
      <p className="mb-3 text-sm text-muted">{t("community.rules")}</p>
      {(dm.ready || promos) && (
        <div className="mb-3 flex gap-2">
          <button
            className={view === "topics" ? "btn-primary" : "btn-secondary"}
            onClick={() => setView("topics")}
          >
            {t("community.title")}
          </button>
          {dm.ready && (
            <button
              className={view === "dm" ? "btn-primary" : "btn-secondary"}
              onClick={() => setView("dm")}
            >
              {t("community.dm.tab")}
              {dm.unread > 0 ? ` (${dm.unread})` : ""}
            </button>
          )}
          {promos && (
            <button
              className={view === "promos" ? "btn-primary" : "btn-secondary"}
              onClick={() => setView("promos")}
            >
              {t("community.joint.tab")}
            </button>
          )}
        </div>
      )}
      {dm.ready && view === "dm" && <CommunityDm canWrite={canWrite} loc={loc} t={t} />}
      {promos && view === "promos" && <CommunityPromos canWrite={canWrite} loc={loc} t={t} />}
      {view === "topics" && state === "soon" && <Empty>{t("community.soon")}</Empty>}
      {view === "topics" && state !== "soon" && openId ? (
        <ThreadView
          id={openId}
          canWrite={canWrite}
          loc={loc}
          t={t}
          onBack={() => {
            setOpenId(null);
            reload();
          }}
        />
      ) : (
        view === "topics" &&
        state !== "soon" && (
          <>
            <div className="mb-3 flex flex-wrap gap-2">
              {SECTIONS.map((s) => (
                <button
                  key={s}
                  className={section === s ? "btn-primary" : "btn-secondary"}
                  onClick={() => {
                    setSection(s);
                    setTopic(null);
                    setComposing(false);
                  }}
                >
                  {t(`community.section.${s}` as AdminKey)}
                </button>
              ))}
            </div>
            {section === "offers" && (
              <div className="mb-3 flex flex-wrap gap-2 text-sm">
                {[null, ...TOPICS].map((x) => (
                  <button
                    key={x ?? "all"}
                    className={topic === x ? "btn-primary" : "btn-ghost"}
                    onClick={() => setTopic(x)}
                  >
                    {t(`community.topic.${x ?? "all"}` as AdminKey)}
                  </button>
                ))}
              </div>
            )}
            <form
              className="mb-3 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                reload();
              }}
            >
              <input
                className="input max-w-sm"
                maxLength={80}
                placeholder={t("community.searchPlaceholder")}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <button className="btn-secondary">{t("community.search")}</button>
              {canWrite && (
                <>
                  <button
                    type="button"
                    className="btn-primary ml-auto"
                    onClick={() => setComposing((v) => !v)}
                  >
                    {t("community.new")}
                  </button>
                  <HelpTip article="community" anchor="post" />
                </>
              )}
            </form>
            <ErrorBox error={load.error} />
            {composing && (
              <NewThread
                section={section}
                topic={topic}
                t={t}
                onDone={(id) => {
                  setComposing(false);
                  setOpenId(id);
                }}
              />
            )}
            {state === "ready" && items.length === 0 && <Empty>{t("community.empty")}</Empty>}
            <ul className="space-y-2">
              {items.map((it) => (
                <li key={it.id}>
                  <button
                    className="card block w-full p-3 text-left"
                    onClick={() => setOpenId(it.id)}
                  >
                    <div className="font-medium">{it.title}</div>
                    <div className="mt-1 line-clamp-2 text-sm text-muted">{it.excerpt}</div>
                    <div className="mt-1 text-xs text-muted">
                      {it.mine ? t("community.you") : (it.author ?? t("community.anon"))} ·{" "}
                      {t("community.postsCount", { n: it.posts })} ·{" "}
                      {new Date(it.lastPostAt).toLocaleDateString(loc)}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
            {next !== null && (
              <button
                className="btn-secondary mt-3"
                disabled={load.busy}
                onClick={() =>
                  void load.run({ section, topic, search, offset: next }).catch(() => {})
                }
              >
                {t("community.more")}
              </button>
            )}
          </>
        )
      )}
      {state === "loading" && !load.error && null}
      <p className="mt-4 text-xs text-muted">
        <Link to="/admin/settings">{t("community.joinLink")}</Link>
      </p>
    </>
  );
}

type T = ReturnType<typeof adminT>;

function NewThread({
  section,
  topic,
  t,
  onDone,
}: {
  section: Section;
  topic: Topic | null;
  t: T;
  onDone: (id: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const save = useAction(async () => {
    const r = await createCommunityThreadFn({ data: { section, topic, title, body } });
    if (!r.soon) onDone(r.id);
  });
  return (
    <Card title={t("community.new")} className="mb-3">
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void save.run().catch(() => {});
        }}
      >
        <Field label={t("community.titleLabel")}>
          <input
            className="input"
            maxLength={140}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </Field>
        <Field label={t("community.bodyLabel")}>
          <textarea
            className="input min-h-28"
            maxLength={4000}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        </Field>
        <button className="btn-primary" disabled={save.busy}>
          {t("community.publish")}
        </button>
        <ErrorBox error={save.error} />
      </form>
    </Card>
  );
}

function ThreadView({
  id,
  canWrite,
  loc,
  t,
  onBack,
}: {
  id: string;
  canWrite: boolean;
  loc: string;
  t: T;
  onBack: () => void;
}) {
  const [view, setView] = useState<Open | null>(null);
  const [posts, setPosts] = useState<Open["posts"]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [reply, setReply] = useState("");
  const [note, setNote] = useState("");
  const load = useAction(async (offset: number) => {
    const r = await communityThreadFn({ data: { id, offset } });
    if (r.soon) return;
    setView(r);
    setPosts((p) => (offset === 0 ? r.posts : [...p, ...r.posts]));
    setNext(r.next);
  });
  useEffect(() => {
    void load.run(0).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  const send = useAction(async () => {
    await createCommunityPostFn({ data: { threadId: id, body: reply } });
    setReply("");
    await load.run(0);
  });
  const report = useAction(async (postId: string | null) => {
    const r = await reportCommunityFn({ data: { threadId: id, postId } });
    if (!r.soon)
      setNote(
        r.already
          ? t("community.reportAlready")
          : r.hidden
            ? t("community.autoHidden")
            : t("community.reported"),
      );
  });
  return (
    <div>
      <button className="btn-ghost mb-3" onClick={onBack}>
        {t("community.back")}
      </button>
      <ErrorBox error={load.error ?? send.error ?? report.error} />
      {view && (
        <Card title={view.thread.title}>
          <div className="whitespace-pre-wrap text-sm">{view.thread.body}</div>
          <div className="mt-2 flex items-center gap-3 text-xs text-muted">
            <span>
              {view.thread.mine ? (
                t("community.you")
              ) : (
                <AuthorName name={view.thread.author} slug={view.thread.authorSlug} t={t} />
              )}{" "}
              · {new Date(view.thread.createdAt).toLocaleString(loc)}
            </span>
            {canWrite && !view.thread.mine && (
              <button className="underline" onClick={() => void report.run(null).catch(() => {})}>
                {t("community.report")}
              </button>
            )}
          </div>
        </Card>
      )}
      {note && <p className="mt-2 text-sm text-ok">{note}</p>}
      <ul className="mt-3 space-y-2">
        {posts.map((p) => (
          <li key={p.id} className="card p-3">
            <div className="whitespace-pre-wrap text-sm">{p.body}</div>
            <div className="mt-1 flex items-center gap-3 text-xs text-muted">
              <span>
                {p.mine ? (
                  t("community.you")
                ) : (
                  <AuthorName name={p.author} slug={p.authorSlug} t={t} />
                )}{" "}
                · {new Date(p.createdAt).toLocaleString(loc)}
              </span>
              {canWrite && !p.mine && (
                <button className="underline" onClick={() => void report.run(p.id).catch(() => {})}>
                  {t("community.report")}
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
      {next !== null && (
        <button
          className="btn-secondary mt-3"
          disabled={load.busy}
          onClick={() => void load.run(next).catch(() => {})}
        >
          {t("community.more")}
        </button>
      )}
      {canWrite && view && (
        <form
          className="mt-4 space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            void send.run().catch(() => {});
          }}
        >
          <textarea
            className="input min-h-20"
            maxLength={4000}
            placeholder={t("community.replyPlaceholder")}
            value={reply}
            onChange={(e) => setReply(e.target.value)}
          />
          <button className="btn-primary" disabled={send.busy}>
            {t("community.reply")}
          </button>
        </form>
      )}
    </div>
  );
}

/** Имя автора; у показываемого автора — ссылка на его публичную страницу (С6). */
function AuthorName({
  name,
  slug,
  t,
}: {
  name: string | null;
  slug: string | null;
  t: (k: "community.anon") => string;
}) {
  if (!name) return <>{t("community.anon")}</>;
  return slug ? (
    <a href={`/author/${slug}`} target="_blank" rel="noreferrer" className="underline">
      {name}
    </a>
  ) : (
    <>{name}</>
  );
}
