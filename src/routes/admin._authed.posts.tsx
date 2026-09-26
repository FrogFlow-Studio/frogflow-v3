import { createFileRoute, Link, useRouteContext, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { cancelPostFn, postsFn, publishPostFn } from "@/app/admin/posts.functions";
import { adminT, intlLocale, type AdminKey } from "@/app/i18n/admin";
import { Badge, Card, Empty, ErrorBox, Field, PageTitle, useAction } from "@/app/ui";
import { CAPTION_MAX, mediaTypeOf, type PostKind } from "@/core/social/post-draft";

export const Route = createFileRoute("/admin/_authed/posts")({
  loader: () => postsFn(),
  component: PostsPage,
});

type Data = Awaited<ReturnType<typeof postsFn>>;
type Row = Data["posts"][number];

const STATE_TONE: Record<Row["state"], "neutral" | "ok" | "warn" | "danger" | "accent"> = {
  published: "ok",
  scheduled: "accent",
  publishing: "warn",
  failed: "danger",
  cancelled: "neutral",
};

function useAdminI18n() {
  const { shop } = useRouteContext({ from: "/admin/_authed" });
  return { t: adminT(shop.locale), intl: intlLocale(shop.locale) };
}

function PostsPage() {
  const data = Route.useLoaderData();
  const { t } = useAdminI18n();
  const title = t("posts.title");
  if (!data.configured)
    return (
      <>
        <PageTitle title={title} />
        <Card>
          <Empty>{t("posts.notConfigured")}</Empty>
        </Card>
      </>
    );
  if (data.accounts.length === 0)
    return (
      <>
        <PageTitle title={title} subtitle={t("posts.subtitle")} />
        <Card>
          <Empty>
            {t("posts.notConnected")}{" "}
            <Link to="/admin/settings" className="underline">
              {t("posts.connectInSettings")}
            </Link>
          </Empty>
        </Card>
      </>
    );
  return (
    <>
      <PageTitle title={title} subtitle={t("posts.subtitle")} />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <PostForm data={data} />
        <RecentPosts rows={data.posts} />
      </div>
    </>
  );
}

type Media = { key: string; name: string };

async function upload(file: File): Promise<{ key: string } | { status: number }> {
  const fd = new FormData();
  // Фото — в бакет картинок, видео — в бакет файлов (он принимает большие).
  fd.set("kind", mediaTypeOf(file.type || file.name) === "video" ? "file" : "image");
  fd.set("file", file);
  const r = await fetch("/api/admin/upload", { method: "POST", body: fd });
  const j = (await r.json().catch(() => ({}))) as { key?: string };
  return r.ok && j.key ? { key: j.key } : { status: r.status };
}

function PostForm({ data }: { data: Data }) {
  const router = useRouter();
  const { t } = useAdminI18n();
  const live = data.accounts.filter((a) => !a.expired);
  const [kind, setKind] = useState<PostKind>("feed");
  const [accountIds, setAccountIds] = useState<string[]>(live[0] ? [live[0].id] : []);
  const [text, setText] = useState("");
  const [media, setMedia] = useState<Media[]>([]);
  const [later, setLater] = useState(false);
  const [at, setAt] = useState("");
  const [done, setDone] = useState<string | null>(null);
  const [problems, setProblems] = useState<string[]>([]);

  const addFiles = useAction(async (files: FileList) => {
    for (const f of Array.from(files)) {
      const r = await upload(f);
      if ("status" in r) throw new Error(t("posts.uploadFailed", { status: r.status }));
      setMedia((m) => [...m, { key: r.key, name: f.name }]);
    }
  });

  const publish = useAction(async () => {
    setDone(null);
    setProblems([]);
    const r = await publishPostFn({
      data: {
        kind,
        accountIds,
        text: kind === "story" ? "" : text,
        media: media.map((m) => m.key),
        scheduledFor: later && at ? new Date(at).toISOString() : null,
      },
    });
    if (!r.ok) {
      if ("errors" in r) setProblems(r.errors.map((e) => t(`posts.error.${e}` as AdminKey)));
      else setProblems([r.error]);
      return;
    }
    setDone(t(r.state === "scheduled" ? "posts.done.scheduled" : "posts.done.published"));
    setText("");
    setMedia([]);
    setAt("");
    await router.invalidate();
  });

  const accept =
    kind === "feed"
      ? "image/jpeg,image/png"
      : kind === "reel"
        ? "video/mp4,video/quicktime"
        : "image/jpeg,image/png,video/mp4,video/quicktime";
  const maxFiles = kind === "feed" ? 10 : 1;

  return (
    <Card title={t("posts.new")}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void publish.run().catch(() => {});
        }}
      >
        <Field label={t("posts.kind")} hint={t(`posts.kindHint.${kind}`)}>
          <div className="flex gap-2">
            {(["feed", "reel", "story"] as const).map((k) => (
              <button
                key={k}
                type="button"
                className={k === kind ? "btn-primary" : "btn-secondary"}
                onClick={() => {
                  setKind(k);
                  if (k !== "feed") setMedia((m) => m.slice(0, 1));
                }}
              >
                {t(`posts.kind.${k}`)}
              </button>
            ))}
          </div>
        </Field>

        <Field label={t("posts.accounts")}>
          <div className="space-y-1">
            {data.accounts.map((a) => (
              <label key={a.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  disabled={a.expired}
                  checked={accountIds.includes(a.id)}
                  onChange={(e) =>
                    setAccountIds((ids) =>
                      e.target.checked ? [...ids, a.id] : ids.filter((x) => x !== a.id),
                    )
                  }
                />
                {a.name}
                {a.expired && <Badge tone="warn">{t("posts.accountExpired")}</Badge>}
              </label>
            ))}
          </div>
        </Field>

        {kind !== "story" && (
          <Field label={t("posts.text")} hint={t("posts.textHint", { n: text.length })}>
            <textarea
              className="input min-h-28 w-full"
              value={text}
              maxLength={CAPTION_MAX}
              onChange={(e) => setText(e.target.value)}
            />
          </Field>
        )}

        <Field label={t("posts.media")}>
          <div className="space-y-2">
            {media.map((m) => (
              <div key={m.key} className="flex items-center justify-between gap-2 text-sm">
                <span className="truncate">{m.name}</span>
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => setMedia((xs) => xs.filter((x) => x.key !== m.key))}
                >
                  {t("posts.remove")}
                </button>
              </div>
            ))}
            {media.length < maxFiles && (
              <input
                type="file"
                accept={accept}
                multiple={kind === "feed"}
                disabled={addFiles.busy}
                onChange={(e) => {
                  if (e.target.files?.length) void addFiles.run(e.target.files).catch(() => {});
                  e.target.value = "";
                }}
              />
            )}
            {addFiles.busy && <p className="text-xs text-muted">{t("posts.uploading")}</p>}
            <ErrorBox error={addFiles.error} />
          </div>
        </Field>

        <Field label={t("posts.when")} hint={later ? t("posts.timezoneHint") : undefined}>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <label className="flex items-center gap-1">
              <input type="radio" checked={!later} onChange={() => setLater(false)} />
              {t("posts.now")}
            </label>
            <label className="flex items-center gap-1">
              <input type="radio" checked={later} onChange={() => setLater(true)} />
              {t("posts.later")}
            </label>
            {later && (
              <input
                type="datetime-local"
                className="input h-9"
                value={at}
                onChange={(e) => setAt(e.target.value)}
              />
            )}
          </div>
        </Field>

        {problems.length > 0 && (
          <ul className="space-y-1 text-sm text-danger">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}
        <ErrorBox error={publish.error} />
        {done && <p className="text-sm text-ok">{done}</p>}
        <button
          type="submit"
          className="btn-primary"
          disabled={publish.busy || addFiles.busy || (later && !at)}
        >
          {later ? t("posts.schedule") : t("posts.publish")}
        </button>
      </form>
    </Card>
  );
}

function RecentPosts({ rows }: { rows: Row[] }) {
  const router = useRouter();
  const { t, intl } = useAdminI18n();
  const fmt = (iso: string) =>
    new Date(iso).toLocaleString(intl, { dateStyle: "medium", timeStyle: "short" });
  const cancel = useAction(async (postId: string) => {
    if (!confirm(t("posts.cancelConfirm"))) return;
    await cancelPostFn({ data: { postId } });
    await router.invalidate();
  });
  return (
    <Card title={t("posts.recent")}>
      {rows.length === 0 ? (
        <Empty>{t("posts.empty")}</Empty>
      ) : (
        <ul className="divide-y divide-line">
          {rows.map((r, i) => (
            <li key={r.postId ?? i} className="space-y-1 py-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Badge>{t(`posts.kind.${r.kind}`)}</Badge>
                <Badge tone={STATE_TONE[r.state]}>{t(`posts.state.${r.state}`)}</Badge>
                <span className="text-xs text-muted">
                  {r.state === "scheduled" && r.scheduledFor
                    ? t("posts.at", { when: fmt(r.scheduledFor) })
                    : fmt(r.createdAt)}
                </span>
              </div>
              {r.text && <p className="line-clamp-2 text-muted">{r.text}</p>}
              {r.state === "failed" && r.error && <p className="text-xs text-danger">{r.error}</p>}
              <div className="flex gap-2">
                {r.url && (
                  <a className="btn-ghost" href={r.url} target="_blank" rel="noreferrer">
                    {t("posts.open")}
                  </a>
                )}
                {r.state === "scheduled" && r.postId && (
                  <button
                    type="button"
                    className="btn-ghost"
                    disabled={cancel.busy}
                    onClick={() => void cancel.run(r.postId!).catch(() => {})}
                  >
                    {t("posts.cancel")}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <ErrorBox error={cancel.error} />
    </Card>
  );
}
