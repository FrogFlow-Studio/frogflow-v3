import { useMemo, useState } from "react";
import { catchupPrivateFn, catchupPublicFn, postCommentsFn } from "@/app/admin/instagram.functions";
import { HelpTip } from "@/app/admin/help-panel";
import { Badge, Card, ErrorBox, Field, useAction } from "@/app/ui";
import { BLOCK_REASON, type Data, REPLY_STATUS, useAdminI18n } from "./shared";
import { usePosts } from "./rule-form";

/** Ответы на пропущенные комментарии. */

export function CatchupCard({ data }: { data: Data }) {
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
    <Card
      title={t("instagram.catchup.title")}
      help={<HelpTip article="instagram" anchor="catchup" />}
    >
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
