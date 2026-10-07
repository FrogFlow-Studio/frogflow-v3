import { createFileRoute, Link, useRouteContext, useRouter } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  automationLogsFn,
  catchupPrivateFn,
  catchupPublicFn,
  deleteAutomationFn,
  instagramFn,
  instagramPostsFn,
  postCommentsFn,
  saveAutomationFn,
  syncInstagramPostFn,
  toggleAutomationFn,
} from "@/app/admin/instagram.functions";
import { adminT, intlLocale, type AdminKey, type AdminT } from "@/app/i18n/admin";
import { ProductSearch } from "@/app/admin/product-picker";
import { Badge, Card, Empty, ErrorBox, Field, PageTitle, Switch, useAction } from "@/app/ui";
import {
  DEFAULT_REPLY_PROMPT,
  DM_LIMIT_PLAIN,
  withReplyPrompt,
} from "@/core/instagram/comment-rules";

export const Route = createFileRoute("/admin/_authed/instagram")({
  loader: () => instagramFn(),
  component: InstagramPage,
});

type Data = Awaited<ReturnType<typeof instagramFn>>;
type Automation = Data["automations"][number];
type Post = Awaited<ReturnType<typeof instagramPostsFn>>["posts"][number];
type Button = Automation["buttons"][number];
type CommentRow = Awaited<ReturnType<typeof postCommentsFn>>["comments"][number];

const REPLY_STATUS: Record<
  CommentRow["replyStatus"],
  { label: AdminKey; tone: "neutral" | "ok" | "warn" | "danger" | "accent" }
> = {
  owner: { label: "instagram.reply.owner", tone: "neutral" },
  sent: { label: "instagram.reply.sent", tone: "ok" },
  failed: { label: "instagram.reply.failed", tone: "danger" },
  no_match: { label: "instagram.reply.no_match", tone: "neutral" },
  no_automation: { label: "instagram.reply.no_automation", tone: "neutral" },
  missing: { label: "instagram.reply.missing", tone: "warn" },
};
const BLOCK_REASON: Record<string, AdminKey> = {
  nested: "instagram.block.nested",
  too_old: "instagram.block.too_old",
  cannot_reply: "instagram.block.cannot_reply",
};

/** Переводчик и код Intl для языка панели — из контекста маршрута. */
function useAdminI18n() {
  const { shop } = useRouteContext({ from: "/admin/_authed" });
  return { t: adminT(shop.locale), intl: intlLocale(shop.locale) };
}

function InstagramPage() {
  const data = Route.useLoaderData();
  const { t } = useAdminI18n();
  const [editing, setEditing] = useState<Automation | null | "new">(null);
  if (!data.configured)
    return (
      <>
        <PageTitle title="Instagram" />
        <Card>
          <Empty>{t("instagram.notConfigured")}</Empty>
        </Card>
      </>
    );
  if (data.accounts.length === 0)
    return (
      <>
        <PageTitle title="Instagram" subtitle={t("instagram.subtitleShort")} />
        <Card>
          <Empty>
            {t("instagram.notConnected")}{" "}
            <Link to="/admin/settings" className="underline">
              {t("instagram.connectInSettings")}
            </Link>
          </Empty>
        </Card>
      </>
    );
  return (
    <>
      <PageTitle title="Instagram" subtitle={t("instagram.subtitle")} />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          <RulesCard data={data} onEdit={setEditing} />
          {editing !== null && (
            <RuleForm
              data={data}
              initial={editing === "new" ? null : editing}
              onClose={() => setEditing(null)}
            />
          )}
        </div>
        <div className="space-y-4">
          <CatchupCard data={data} />
          <FallbackJournal rows={data.fallbackSends} />
        </div>
      </div>
    </>
  );
}

function targetLabel(t: AdminT, a: Automation): string {
  if (a.trigger === "story_reply") return t("instagram.target.storyReplies");
  if (!a.platformPostId) return t("instagram.target.allPosts");
  return a.postTitle
    ? t("instagram.target.postTitled", { title: a.postTitle.slice(0, 40) })
    : t("instagram.target.postId", { id: a.platformPostId });
}

function RulesCard({ data, onEdit }: { data: Data; onEdit: (a: Automation | "new") => void }) {
  const router = useRouter();
  const { t } = useAdminI18n();
  const toggle = useAction(async (a: Automation) => {
    await toggleAutomationFn({ data: { id: a.id, isActive: !a.isActive } });
    await router.invalidate();
  });
  const remove = useAction(async (a: Automation) => {
    if (!confirm(t("instagram.rules.deleteConfirm", { name: a.name }))) return;
    await deleteAutomationFn({ data: { id: a.id } });
    await router.invalidate();
  });
  return (
    <Card
      title={t("instagram.rules.title")}
      actions={
        <button className="btn-primary text-xs" onClick={() => onEdit("new")}>
          {t("instagram.rules.new")}
        </button>
      }
    >
      {data.automationsError ? (
        <p className="text-sm text-danger">
          {t(data.automationsError.key as never) || data.automationsError.message}
        </p>
      ) : data.automations.length === 0 ? (
        <Empty>{t("instagram.rules.empty")}</Empty>
      ) : (
        <ul className="divide-y divide-line">
          {data.automations.map((a) => (
            <li key={a.id} className="py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{a.name}</span>
                    <Badge tone={a.isActive ? "ok" : "neutral"}>
                      {a.isActive ? t("instagram.rules.active") : t("instagram.rules.inactive")}
                    </Badge>
                    {a.twoStepDm && (
                      <Badge tone="accent">{t("instagram.rules.twoStepBadge")}</Badge>
                    )}
                    {data.accounts.length > 1 && (
                      <span className="text-xs text-muted">
                        {data.accounts.find((x) => x.id === a.accountId)?.name ?? a.accountId}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-muted">
                    {targetLabel(t, a)} ·{" "}
                    {a.keywords.length
                      ? `${a.matchMode === "exact" ? t("instagram.match.exact") : t("instagram.match.contains")}: ${a.keywords.join(", ")}`
                      : t("instagram.rules.anyComment")}
                  </p>
                  <p className="mt-1 line-clamp-2 text-sm">{a.dmMessage}</p>
                  <p className="mt-1 text-xs text-muted tabular-nums">
                    {t("instagram.rules.stats", {
                      triggered: a.stats.triggered,
                      sent: a.stats.dmsSent,
                    })}
                    {a.stats.dmsFailed > 0 && (
                      <span className="text-danger">
                        {" "}
                        {t("instagram.rules.failedCount", { n: a.stats.dmsFailed })}
                      </span>
                    )}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <Switch
                    checked={a.isActive}
                    onChange={() => void toggle.run(a).catch(() => {})}
                    label={t("instagram.rules.enabled")}
                  />
                  <button className="btn-ghost text-xs" onClick={() => onEdit(a)}>
                    {t("common.edit")}
                  </button>
                  <button
                    className="btn-ghost text-xs text-danger"
                    onClick={() => void remove.run(a).catch(() => {})}
                  >
                    {t("common.delete")}
                  </button>
                </div>
              </div>
              <LogsDisclosure id={a.id} />
            </li>
          ))}
        </ul>
      )}
      <ErrorBox error={toggle.error ?? remove.error} />
    </Card>
  );
}

function LogsDisclosure({ id }: { id: string }) {
  const { t, intl } = useAdminI18n();
  const [open, setOpen] = useState(false);
  const [onlyFailed, setOnlyFailed] = useState(false);
  const [logs, setLogs] = useState<Awaited<ReturnType<typeof automationLogsFn>>["logs"] | null>(
    null,
  );
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLogs(null);
    automationLogsFn({ data: { id, onlyFailed } })
      .then((r) => {
        if (!cancelled) setLogs(r.logs);
      })
      .catch((e) => {
        if (!cancelled) setError(e);
      });
    return () => {
      cancelled = true;
    };
  }, [open, onlyFailed, id]);
  return (
    <div className="mt-2">
      <button className="btn-ghost text-xs" onClick={() => setOpen((v) => !v)}>
        {open ? t("instagram.logs.hide") : t("instagram.logs.show")}
      </button>
      {open && (
        <div className="mt-2 rounded-md border border-line p-2 text-xs">
          <label className="mb-2 flex items-center gap-2">
            <input
              type="checkbox"
              checked={onlyFailed}
              onChange={(e) => setOnlyFailed(e.target.checked)}
            />
            {t("instagram.logs.onlyFailed")}
          </label>
          <ErrorBox error={error} />
          {logs === null ? (
            <p className="text-muted">{t("instagram.loading")}</p>
          ) : logs.length === 0 ? (
            <p className="text-muted">{t("instagram.logs.empty")}</p>
          ) : (
            <ul className="max-h-64 space-y-1 overflow-auto">
              {logs.map((l, i) => (
                <li key={`${l.commentId}-${i}`} className="flex flex-wrap gap-2">
                  <Badge
                    tone={l.status === "sent" ? "ok" : l.status === "failed" ? "danger" : "neutral"}
                  >
                    {l.status || "?"}
                  </Badge>
                  {l.username && <span>@{l.username}</span>}
                  <span className="truncate text-muted">{l.commentText}</span>
                  {l.error && <span className="text-danger">{l.error}</span>}
                  {l.createdAt && (
                    <span className="text-muted">{new Date(l.createdAt).toLocaleString(intl)}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function usePosts(accountId: string) {
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    setPosts(null);
    setError(null);
    instagramPostsFn({ data: { accountId } })
      .then((r) => {
        if (!cancelled) setPosts(r.posts);
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e);
          setPosts([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [accountId, nonce]);
  return { posts, error, refresh: () => setNonce((n) => n + 1), setPosts };
}

function PostPicker({
  accountId,
  value,
  onChange,
}: {
  accountId: string;
  value: { platformPostId: string; postId: string; title: string } | null;
  onChange: (v: { platformPostId: string; postId: string; title: string } | null) => void;
}) {
  const { t, intl } = useAdminI18n();
  const { posts, error, refresh, setPosts } = usePosts(accountId);
  const [url, setUrl] = useState("");
  const sync = useAction(async () => {
    const p = await syncInstagramPostFn({ data: { accountId, url: url.trim() } });
    setPosts((prev) => [p, ...(prev ?? []).filter((x) => x.platformPostId !== p.platformPostId)]);
    onChange({ platformPostId: p.platformPostId, postId: p.zernioPostId ?? "", title: p.caption });
    setUrl("");
  });
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <select
          className="input"
          value={value?.platformPostId ?? ""}
          onChange={(e) => {
            const p = posts?.find((x) => x.platformPostId === e.target.value);
            onChange(
              p
                ? {
                    platformPostId: p.platformPostId,
                    postId: p.zernioPostId ?? "",
                    title: p.caption,
                  }
                : null,
            );
          }}
        >
          <option value="">{t("instagram.posts.all")}</option>
          {(posts ?? []).map((p) => (
            <option key={p.platformPostId} value={p.platformPostId}>
              {[
                p.publishedAt ? new Date(p.publishedAt).toLocaleDateString(intl) : "",
                p.kind,
                p.caption || p.platformPostId,
              ]
                .filter(Boolean)
                .join(" · ")}
              {p.zernioPostId ? "" : ` ${t("instagram.posts.noZernioId")}`}
            </option>
          ))}
        </select>
        <button type="button" className="btn-secondary text-xs" onClick={refresh}>
          {posts === null ? "…" : t("instagram.posts.refresh")}
        </button>
      </div>
      {value && !value.postId && (
        <p className="text-xs text-danger">{t("instagram.posts.missingId")}</p>
      )}
      <div className="flex gap-2">
        <input
          className="input"
          placeholder="https://www.instagram.com/reel/…"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <button
          type="button"
          className="btn-secondary text-xs"
          disabled={!url.trim() || sync.busy}
          onClick={() => void sync.run().catch(() => {})}
        >
          {sync.busy ? t("instagram.posts.searching") : t("instagram.posts.findByUrl")}
        </button>
      </div>
      <ErrorBox error={error ?? sync.error} />
    </div>
  );
}

function ButtonsEditor({
  buttons,
  onChange,
  telegramUsername,
}: {
  buttons: Button[];
  onChange: (b: Button[]) => void;
  telegramUsername: string | null;
}) {
  const { t } = useAdminI18n();
  const [picking, setPicking] = useState(false);
  const update = (i: number, patch: Partial<Button>) =>
    onChange(buttons.map((b, j) => (j === i ? { ...b, ...patch } : b)));
  return (
    <div className="space-y-2">
      {buttons.map((b, i) => (
        <div key={i} className="flex flex-wrap gap-2">
          <input
            className="input w-52"
            placeholder={t("instagram.buttons.textPlaceholder")}
            maxLength={40}
            value={b.title}
            onChange={(e) => update(i, { title: e.target.value })}
          />
          <select
            className="input w-32"
            value={b.type}
            onChange={(e) => update(i, { type: e.target.value as Button["type"] })}
          >
            <option value="url">{t("instagram.buttons.typeUrl")}</option>
            <option value="postback">{t("instagram.buttons.typePostback")}</option>
          </select>
          {b.type === "url" ? (
            <input
              className="input min-w-48 flex-1"
              placeholder="https://…"
              value={b.url ?? ""}
              onChange={(e) => update(i, { url: e.target.value })}
            />
          ) : (
            <input
              className="input min-w-48 flex-1"
              placeholder="CATALOG"
              value={b.payload ?? ""}
              onChange={(e) => update(i, { payload: e.target.value })}
            />
          )}
          <button
            type="button"
            className="btn-ghost text-xs text-danger"
            onClick={() => onChange(buttons.filter((_, j) => j !== i))}
          >
            ×
          </button>
        </div>
      ))}
      {buttons.length < 3 && (
        <div className="flex gap-2">
          <button
            type="button"
            className="btn-secondary text-xs"
            onClick={() => onChange([...buttons, { type: "url", title: "", url: "" }])}
          >
            {t("instagram.buttons.add")}
          </button>
          <button
            type="button"
            className="btn-secondary text-xs"
            onClick={() => setPicking((v) => !v)}
          >
            {t("instagram.buttons.addProduct")}
          </button>
          {telegramUsername && (
            <button
              type="button"
              className="btn-secondary text-xs"
              onClick={() =>
                onChange([
                  ...buttons,
                  {
                    type: "url",
                    title: t("instagram.buttons.openTelegram"),
                    url: `https://t.me/${telegramUsername}`,
                  },
                ])
              }
            >
              {t("instagram.buttons.addTelegram")}
            </button>
          )}
        </div>
      )}
      {picking && buttons.length < 3 && (
        <div className="space-y-1">
          <p className="text-xs text-muted">{t("instagram.buttons.productHint")}</p>
          <ProductSearch
            t={t}
            autoFocus
            onPick={(p) => {
              onChange([
                ...buttons,
                {
                  type: "postback",
                  title: t("instagram.buttons.buyTitle"),
                  payload: `PROD:${p.id}`,
                },
              ]);
              setPicking(false);
            }}
          />
        </div>
      )}
    </div>
  );
}

function RuleForm({
  data,
  initial,
  onClose,
}: {
  data: Data;
  initial: Automation | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const { t } = useAdminI18n();
  const [accountId, setAccountId] = useState(initial?.accountId ?? data.accounts[0]!.id);
  const [name, setName] = useState(initial?.name ?? "");
  const [trigger, setTrigger] = useState<"comment" | "story_reply">(initial?.trigger ?? "comment");
  const [target, setTarget] = useState(
    initial?.platformPostId
      ? {
          platformPostId: initial.platformPostId,
          postId: initial.postId ?? "",
          title: initial.postTitle,
        }
      : null,
  );
  const [keywords, setKeywords] = useState(initial?.keywords.join(", ") ?? "");
  const [replyToAll, setReplyToAll] = useState(Boolean(initial && initial.keywords.length === 0));
  const [matchMode, setMatchMode] = useState<"exact" | "contains">(
    initial?.matchMode ?? "contains",
  );
  const [dmMessage, setDmMessage] = useState(initial?.dmMessage ?? "");
  const [buttons, setButtons] = useState<Button[]>(initial?.buttons ?? []);
  // Публичный ответ: основной и варианты — Zernio чередует их, чтобы одинаковые
  // ответы под постом не выглядели как спам.
  const [commentReplies, setCommentReplies] = useState<string[]>(() => {
    const all = [initial?.commentReply ?? "", ...(initial?.commentReplyVariations ?? [])];
    return all.filter((r, i) => i === 0 || r.trim());
  });
  const [twoStepDm, setTwoStepDm] = useState(initial?.twoStepDm ?? false);
  const [secondDmMessage, setSecondDmMessage] = useState(initial?.secondDmMessage ?? "");
  const [unresolvedPrompt, setUnresolvedPrompt] = useState(initial?.unresolvedPrompt ?? "");
  const [replyPrompt, setReplyPrompt] = useState(initial?.replyPrompt ?? DEFAULT_REPLY_PROMPT);

  // Кнопки всегда уходят вторым сообщением (первое — private-reply без кнопок),
  // поэтому с кнопками два шага включены всегда.
  const twoStepOn = twoStepDm || buttons.length > 0;
  const limit = DM_LIMIT_PLAIN;
  // Предел — у первого сообщения целиком, вместе с призывом ответить.
  const firstLength = (twoStepOn ? withReplyPrompt(dmMessage, replyPrompt) : dmMessage).length;
  const save = useAction(async () => {
    await saveAutomationFn({
      data: {
        id: initial?.id,
        original: initial
          ? {
              platformPostId: initial.platformPostId,
              postId: initial.postId,
              trigger: initial.trigger,
            }
          : undefined,
        accountId,
        name: name.trim(),
        trigger,
        platformPostId: target?.platformPostId ?? null,
        postId: target?.postId || null,
        postTitle: target?.title,
        keywords: keywords
          .split(/[,\n;]+/)
          .map((k) => k.trim())
          .filter(Boolean),
        replyToAll: replyToAll && Boolean(target),
        matchMode,
        dmMessage,
        buttons: buttons.filter((b) => b.title.trim()),
        ...(() => {
          const filled = commentReplies.map((r) => r.trim()).filter(Boolean);
          return { commentReply: filled[0] ?? "", commentReplyVariations: filled.slice(1) };
        })(),
        twoStepDm,
        secondDmMessage,
        unresolvedPrompt,
        replyPrompt,
      },
    });
    await router.invalidate();
    onClose();
  });

  return (
    <Card
      title={initial ? t("instagram.form.editTitle") : t("instagram.form.newTitle")}
      actions={
        <button className="btn-ghost text-xs" onClick={onClose}>
          {t("common.close")}
        </button>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save.run().catch(() => {});
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("instagram.form.name")}>
            <input
              className="input"
              value={name}
              maxLength={120}
              required
              onChange={(e) => setName(e.target.value)}
              placeholder={t("instagram.form.namePlaceholder")}
            />
          </Field>
          {data.accounts.length > 1 ? (
            <Field label={t("instagram.form.account")}>
              <select
                className="input"
                value={accountId}
                onChange={(e) => {
                  setAccountId(e.target.value);
                  setTarget(null);
                }}
              >
                {data.accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </Field>
          ) : (
            <Field label={t("instagram.form.trigger")}>
              <select
                className="input"
                value={trigger}
                onChange={(e) => setTrigger(e.target.value as typeof trigger)}
              >
                <option value="comment">{t("instagram.trigger.comment")}</option>
                <option value="story_reply">{t("instagram.trigger.storyReply")}</option>
              </select>
            </Field>
          )}
        </div>
        {trigger === "comment" && (
          <Field label={t("instagram.form.post")} hint={t("instagram.form.postHint")}>
            <PostPicker accountId={accountId} value={target} onChange={setTarget} />
          </Field>
        )}
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem]">
          <Field label={t("instagram.form.keywords")} hint={t("instagram.form.keywordsHint")}>
            <input
              className="input"
              value={keywords}
              disabled={replyToAll && Boolean(target)}
              onChange={(e) => setKeywords(e.target.value)}
              placeholder={t("instagram.form.keywordsPlaceholder")}
            />
          </Field>
          <Field label={t("instagram.form.match")}>
            <select
              className="input"
              value={matchMode}
              onChange={(e) => setMatchMode(e.target.value as typeof matchMode)}
            >
              <option value="contains">{t("instagram.match.contains")}</option>
              <option value="exact">{t("instagram.match.exact")}</option>
            </select>
          </Field>
        </div>
        {target && (
          <div className="flex items-center gap-3">
            <Switch
              checked={replyToAll}
              onChange={setReplyToAll}
              label={t("instagram.form.replyToAll")}
            />
            <span className="text-sm">{t("instagram.form.replyToAllHint")}</span>
          </div>
        )}
        <Field label={t("instagram.form.dmMessage")} hint={`${firstLength} / ${limit}`}>
          <textarea
            className="input min-h-28"
            value={dmMessage}
            maxLength={DM_LIMIT_PLAIN}
            required
            onChange={(e) => setDmMessage(e.target.value)}
            placeholder={t("instagram.form.dmPlaceholder")}
          />
        </Field>
        <div>
          <span className="label">{t("instagram.form.buttons")}</span>
          <ButtonsEditor
            buttons={buttons}
            onChange={setButtons}
            telegramUsername={data.telegramUsername}
          />
        </div>
        <div className="rounded-md border border-line p-3">
          <div className="flex items-center gap-3">
            <Switch
              checked={twoStepOn}
              disabled={buttons.length > 0}
              onChange={setTwoStepDm}
              label={t("instagram.form.twoStep")}
            />
            <span className="text-sm">{t("instagram.form.twoStepLabel")}</span>
          </div>
          <p className="mt-1 text-xs text-muted">{t("instagram.form.twoStepHint")}</p>
          {twoStepOn && (
            <Field
              label={t("instagram.form.replyPrompt")}
              hint={t("instagram.form.replyPromptHint")}
            >
              <input
                className="input mt-2"
                value={replyPrompt}
                maxLength={200}
                onChange={(e) => setReplyPrompt(e.target.value)}
              />
            </Field>
          )}
          {twoStepOn && (
            <Field label={t("instagram.form.secondDm")}>
              <input
                className="input mt-2"
                value={secondDmMessage}
                maxLength={1000}
                onChange={(e) => setSecondDmMessage(e.target.value)}
                placeholder={t("instagram.form.secondDmPlaceholder")}
              />
            </Field>
          )}
        </div>
        <Field label={t("instagram.form.commentReply")} hint={t("instagram.form.commentReplyHint")}>
          <div className="space-y-2">
            {commentReplies.map((reply, i) => (
              <div key={i} className="flex gap-2">
                <input
                  className="input flex-1"
                  value={reply}
                  maxLength={1000}
                  onChange={(e) =>
                    setCommentReplies(commentReplies.map((r, j) => (j === i ? e.target.value : r)))
                  }
                />
                {i > 0 && (
                  <button
                    type="button"
                    className="btn-ghost text-xs"
                    aria-label={t("instagram.form.removeReplyVariant")}
                    title={t("instagram.form.removeReplyVariant")}
                    onClick={() => setCommentReplies(commentReplies.filter((_, j) => j !== i))}
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
            {commentReplies.length < 5 && (
              <button
                type="button"
                className="btn-ghost text-xs"
                onClick={() => setCommentReplies([...commentReplies, ""])}
              >
                {t("instagram.form.addReplyVariant")}
              </button>
            )}
          </div>
        </Field>
        <Field label={t("instagram.form.unresolved")} hint={t("instagram.form.unresolvedHint")}>
          <input
            className="input"
            value={unresolvedPrompt}
            maxLength={500}
            onChange={(e) => setUnresolvedPrompt(e.target.value)}
            placeholder={t("instagram.form.unresolvedPlaceholder")}
          />
        </Field>
        <div className="flex items-center gap-3">
          <button className="btn-primary" disabled={save.busy || !dmMessage.trim() || !name.trim()}>
            {save.busy ? t("instagram.form.saving") : t("common.save")}
          </button>
          {initial && (initial.platformPostId ?? null) !== (target?.platformPostId ?? null) && (
            <span className="text-xs text-warn">{t("instagram.form.postChangeWarn")}</span>
          )}
        </div>
        <ErrorBox error={save.error} />
      </form>
    </Card>
  );
}

function CatchupCard({ data }: { data: Data }) {
  const { t, intl } = useAdminI18n();
  const [accountId, setAccountId] = useState(data.accounts[0]!.id);
  const { posts } = usePosts(accountId);
  const [postId, setPostId] = useState("");
  const [loaded, setLoaded] = useState<Awaited<ReturnType<typeof postCommentsFn>> | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState("");
  const [publicText, setPublicText] = useState("");
  const [results, setResults] = useState<Array<{ commentId: string; ok: boolean; error?: string }>>(
    [],
  );

  const load = useAction(async () => {
    const r = await postCommentsFn({ data: { accountId, postId } });
    setLoaded(r);
    setResults([]);
    setSelected(
      new Set(
        r.comments
          .filter(
            (c) => (c.replyStatus === "missing" || c.replyStatus === "failed") && !c.blockReason,
          )
          .map((c) => c.id),
      ),
    );
    if (r.automation) {
      setMessage(r.automation.dmMessage);
      setPublicText(r.automation.commentReply);
    }
  });
  const ids = useMemo(() => [...selected].slice(0, 25), [selected]);
  const sendPrivate = useAction(async () => {
    if (!confirm(t("instagram.catchup.confirmDm", { n: ids.length }))) return;
    const r = await catchupPrivateFn({
      data: {
        accountId,
        postId,
        commentIds: ids,
        message,
        buttons: loaded?.automation?.buttons,
        twoStepDm: loaded?.automation?.twoStepDm,
        secondDmMessage: loaded?.automation?.secondDmMessage,
      },
    });
    setResults(r.results);
  });
  const sendPublic = useAction(async () => {
    if (!confirm(t("instagram.catchup.confirmPublic", { n: ids.length }))) return;
    const r = await catchupPublicFn({
      data: { accountId, postId, commentIds: ids, message: publicText },
    });
    setResults(r.results);
  });
  const resultOf = (id: string) => results.find((r) => r.commentId === id);

  return (
    <Card title={t("instagram.catchup.title")}>
      <p className="mb-3 text-sm text-muted">{t("instagram.catchup.intro")}</p>
      <div className="flex flex-wrap gap-2">
        {data.accounts.length > 1 && (
          <select
            className="input w-44"
            value={accountId}
            onChange={(e) => {
              setAccountId(e.target.value);
              setPostId("");
              setLoaded(null);
            }}
          >
            {data.accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        )}
        <select
          className="input min-w-48 flex-1"
          value={postId}
          onChange={(e) => {
            setPostId(e.target.value);
            setLoaded(null);
          }}
        >
          <option value="">
            {posts === null
              ? t("instagram.catchup.loadingPosts")
              : t("instagram.catchup.choosePost")}
          </option>
          {(posts ?? []).map((p) => (
            <option key={p.platformPostId} value={p.platformPostId}>
              {[
                p.publishedAt ? new Date(p.publishedAt).toLocaleDateString(intl) : "",
                p.kind,
                p.caption || p.platformPostId,
              ]
                .filter(Boolean)
                .join(" · ")}
            </option>
          ))}
        </select>
        <button
          className="btn-secondary text-xs"
          disabled={!postId || load.busy}
          onClick={() => void load.run().catch(() => {})}
        >
          {load.busy ? t("instagram.catchup.loading") : t("instagram.catchup.load")}
        </button>
      </div>
      <ErrorBox error={load.error} />
      {loaded && (
        <div className="mt-3 space-y-3">
          {!loaded.automation && (
            <p className="text-xs text-warn">{t("instagram.catchup.noRule")}</p>
          )}
          <p className="text-xs text-muted">
            {t("instagram.catchup.counts", {
              total: loaded.comments.length,
              selected: selected.size,
            })}
            <button
              className="btn-ghost ml-2 text-xs"
              onClick={() => setSelected(new Set(loaded.comments.map((c) => c.id)))}
            >
              {t("instagram.catchup.selectAll")}
            </button>
            <button className="btn-ghost text-xs" onClick={() => setSelected(new Set())}>
              {t("instagram.catchup.selectNone")}
            </button>
          </p>
          <ul className="max-h-80 divide-y divide-line overflow-auto rounded-md border border-line">
            {loaded.comments.map((c) => {
              const st = REPLY_STATUS[c.replyStatus];
              const r = resultOf(c.id);
              return (
                <li key={c.id} className="flex items-start gap-2 px-2 py-1.5 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={selected.has(c.id)}
                    disabled={c.replyStatus === "owner"}
                    onChange={(e) =>
                      setSelected((s) => {
                        const n = new Set(s);
                        if (e.target.checked) n.add(c.id);
                        else n.delete(c.id);
                        return n;
                      })
                    }
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">@{c.username || "?"}</span>
                      <Badge tone={st.tone}>{t(st.label)}</Badge>
                      {c.blockReason && (
                        <span className="text-xs text-muted">
                          {BLOCK_REASON[c.blockReason]
                            ? t(BLOCK_REASON[c.blockReason]!)
                            : c.blockReason}
                        </span>
                      )}
                      {r && (
                        <Badge tone={r.ok ? "ok" : "danger"}>
                          {r.ok
                            ? t("instagram.catchup.resultOk")
                            : t("instagram.catchup.resultError")}
                        </Badge>
                      )}
                      {c.createdTime && (
                        <span className="text-xs text-muted">
                          {new Date(c.createdTime).toLocaleString(intl)}
                        </span>
                      )}
                    </div>
                    <p className="truncate text-muted">{c.text}</p>
                    {r && !r.ok && r.error && <p className="text-xs text-danger">{r.error}</p>}
                  </div>
                </li>
              );
            })}
          </ul>
          <Field label={t("instagram.catchup.dmText")}>
            <textarea
              className="input min-h-20"
              value={message}
              maxLength={1000}
              onChange={(e) => setMessage(e.target.value)}
            />
          </Field>
          <button
            className="btn-primary"
            disabled={ids.length === 0 || !message.trim() || sendPrivate.busy}
            onClick={() => void sendPrivate.run().catch(() => {})}
          >
            {sendPrivate.busy
              ? t("instagram.catchup.sending")
              : t("instagram.catchup.sendDm", { n: ids.length })}
          </button>
          <ErrorBox error={sendPrivate.error} />
          <Field label={t("instagram.form.commentReply")} hint={t("instagram.catchup.publicHint")}>
            <input
              className="input"
              value={publicText}
              maxLength={1000}
              onChange={(e) => setPublicText(e.target.value)}
            />
          </Field>
          <button
            className="btn-secondary"
            disabled={ids.length === 0 || !publicText.trim() || sendPublic.busy}
            onClick={() => void sendPublic.run().catch(() => {})}
          >
            {sendPublic.busy
              ? t("instagram.catchup.replying")
              : t("instagram.catchup.replyPublic", { n: ids.length })}
          </button>
          <ErrorBox error={sendPublic.error} />
        </div>
      )}
    </Card>
  );
}

function FallbackJournal({ rows }: { rows: Data["fallbackSends"] }) {
  const { t, intl } = useAdminI18n();
  if (rows.length === 0) return null;
  return (
    <Card title={t("instagram.fallback.title")}>
      <p className="mb-2 text-xs text-muted">{t("instagram.fallback.intro")}</p>
      <ul className="divide-y divide-line text-xs">
        {rows.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-2 py-1.5">
            <Badge tone={r.status === "sent" ? "ok" : r.status === "failed" ? "danger" : "warn"}>
              {r.status}
            </Badge>
            <span className="text-muted">{new Date(r.created_at).toLocaleString(intl)}</span>
            <span>{t("instagram.fallback.comment", { id: r.comment_id })}</span>
            {r.alt_channel_status === "sent" && (
              <span className="text-ok">{t("instagram.fallback.viaDialog")}</span>
            )}
            {r.comment_reply_status === "sent" && (
              <span>{t("instagram.fallback.publicReply")}</span>
            )}
            {r.comment_reply_error === "prompt_sent" && (
              <span>{t("instagram.fallback.promptSent")}</span>
            )}
            {r.error && <span className="text-danger">{r.error.slice(0, 160)}</span>}
          </li>
        ))}
      </ul>
    </Card>
  );
}
