import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
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
import { Badge, Card, Empty, ErrorBox, Field, PageTitle, Switch, useAction } from "@/app/ui";
import { DM_LIMIT_PLAIN, DM_LIMIT_WITH_BUTTONS } from "@/core/instagram/comment-rules";

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
  { label: string; tone: "neutral" | "ok" | "warn" | "danger" | "accent" }
> = {
  owner: { label: "ваш ответ", tone: "neutral" },
  sent: { label: "DM ушла", tone: "ok" },
  failed: { label: "DM не прошла", tone: "danger" },
  no_match: { label: "не по слову", tone: "neutral" },
  no_automation: { label: "нет правила", tone: "neutral" },
  missing: { label: "пропущен", tone: "warn" },
};
const BLOCK_REASON: Record<string, string> = {
  nested: "ответ в ветке — Instagram не принимает private reply",
  too_old: "старше 7 дней",
  cannot_reply: "Instagram помечает canReply=false",
};

function InstagramPage() {
  const data = Route.useLoaderData();
  const [editing, setEditing] = useState<Automation | null | "new">(null);
  if (!data.configured)
    return (
      <>
        <PageTitle title="Instagram" />
        <Card>
          <Empty>Zernio не подключён на платформе — обратитесь к оператору.</Empty>
        </Card>
      </>
    );
  if (data.accounts.length === 0)
    return (
      <>
        <PageTitle title="Instagram" subtitle="Автоответы в Direct на комментарии к постам." />
        <Card>
          <Empty>
            Instagram ещё не подключён.{" "}
            <Link to="/admin/settings" className="underline">
              Подключить в настройках
            </Link>
          </Empty>
        </Card>
      </>
    );
  return (
    <>
      <PageTitle
        title="Instagram"
        subtitle="Комментарий с ключевым словом под постом — и человеку уходит сообщение в Direct. Правила исполняет Zernio, резервный крон раз в 15 минут доотправляет пропущенные."
      />
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

function targetLabel(a: Automation): string {
  if (a.trigger === "story_reply") return "ответы на сторис";
  if (!a.platformPostId) return "все посты";
  return a.postTitle ? `пост «${a.postTitle.slice(0, 40)}…»` : `пост ${a.platformPostId}`;
}

function RulesCard({ data, onEdit }: { data: Data; onEdit: (a: Automation | "new") => void }) {
  const router = useRouter();
  const toggle = useAction(async (a: Automation) => {
    await toggleAutomationFn({ data: { id: a.id, isActive: !a.isActive } });
    await router.invalidate();
  });
  const remove = useAction(async (a: Automation) => {
    if (!confirm(`Удалить правило «${a.name}»? Статистика срабатываний пропадёт.`)) return;
    await deleteAutomationFn({ data: { id: a.id } });
    await router.invalidate();
  });
  return (
    <Card
      title="Правила Comment-to-DM"
      actions={
        <button className="btn-primary text-xs" onClick={() => onEdit("new")}>
          + Новое правило
        </button>
      }
    >
      {data.automations.length === 0 ? (
        <Empty>Правил пока нет. Создайте первое: пост, ключевое слово и текст для Direct.</Empty>
      ) : (
        <ul className="divide-y divide-line">
          {data.automations.map((a) => (
            <li key={a.id} className="py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{a.name}</span>
                    <Badge tone={a.isActive ? "ok" : "neutral"}>
                      {a.isActive ? "работает" : "выключено"}
                    </Badge>
                    {a.twoStepDm && <Badge tone="accent">2 шага</Badge>}
                    {data.accounts.length > 1 && (
                      <span className="text-xs text-muted">
                        {data.accounts.find((x) => x.id === a.accountId)?.name ?? a.accountId}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-muted">
                    {targetLabel(a)} ·{" "}
                    {a.keywords.length
                      ? `${a.matchMode === "exact" ? "точно" : "содержит"}: ${a.keywords.join(", ")}`
                      : "любой комментарий"}
                  </p>
                  <p className="mt-1 line-clamp-2 text-sm">{a.dmMessage}</p>
                  <p className="mt-1 text-xs text-muted tabular-nums">
                    сработало {a.stats.triggered} · DM {a.stats.dmsSent}
                    {a.stats.dmsFailed > 0 && (
                      <span className="text-danger"> · не прошло {a.stats.dmsFailed}</span>
                    )}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <Switch
                    checked={a.isActive}
                    onChange={() => void toggle.run(a).catch(() => {})}
                    label="Включено"
                  />
                  <button className="btn-ghost text-xs" onClick={() => onEdit(a)}>
                    Изменить
                  </button>
                  <button
                    className="btn-ghost text-xs text-danger"
                    onClick={() => void remove.run(a).catch(() => {})}
                  >
                    Удалить
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
        {open ? "Скрыть историю" : "История срабатываний"}
      </button>
      {open && (
        <div className="mt-2 rounded-md border border-line p-2 text-xs">
          <label className="mb-2 flex items-center gap-2">
            <input
              type="checkbox"
              checked={onlyFailed}
              onChange={(e) => setOnlyFailed(e.target.checked)}
            />
            только неудачные
          </label>
          <ErrorBox error={error} />
          {logs === null ? (
            <p className="text-muted">Загрузка…</p>
          ) : logs.length === 0 ? (
            <p className="text-muted">Записей нет.</p>
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
                    <span className="text-muted">{new Date(l.createdAt).toLocaleString("ru")}</span>
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
          <option value="">Все посты аккаунта</option>
          {(posts ?? []).map((p) => (
            <option key={p.platformPostId} value={p.platformPostId}>
              {[
                p.publishedAt ? new Date(p.publishedAt).toLocaleDateString("ru") : "",
                p.kind,
                p.caption || p.platformPostId,
              ]
                .filter(Boolean)
                .join(" · ")}
              {p.zernioPostId ? "" : " (нет id Zernio)"}
            </option>
          ))}
        </select>
        <button type="button" className="btn-secondary text-xs" onClick={refresh}>
          {posts === null ? "…" : "Обновить"}
        </button>
      </div>
      {value && !value.postId && (
        <p className="text-xs text-danger">
          У этого поста нет id записи в Zernio — вставьте ссылку на публикацию ниже, чтобы
          досинхронизировать.
        </p>
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
          {sync.busy ? "Ищем…" : "Найти по ссылке"}
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
  const update = (i: number, patch: Partial<Button>) =>
    onChange(buttons.map((b, j) => (j === i ? { ...b, ...patch } : b)));
  return (
    <div className="space-y-2">
      {buttons.map((b, i) => (
        <div key={i} className="flex flex-wrap gap-2">
          <input
            className="input w-52"
            placeholder="Текст кнопки"
            maxLength={40}
            value={b.title}
            onChange={(e) => update(i, { title: e.target.value })}
          />
          <select
            className="input w-32"
            value={b.type}
            onChange={(e) => update(i, { type: e.target.value as Button["type"] })}
          >
            <option value="url">ссылка</option>
            <option value="postback">команда боту</option>
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
            + Кнопка
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
                    title: "Открыть в Telegram ✈️",
                    url: `https://t.me/${telegramUsername}`,
                  },
                ])
              }
            >
              + В Telegram-бот
            </button>
          )}
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
  const [commentReply, setCommentReply] = useState(initial?.commentReply ?? "");
  const [twoStepDm, setTwoStepDm] = useState(initial?.twoStepDm ?? false);
  const [secondDmMessage, setSecondDmMessage] = useState(initial?.secondDmMessage ?? "");
  const [unresolvedPrompt, setUnresolvedPrompt] = useState(initial?.unresolvedPrompt ?? "");

  const limit = buttons.length && !twoStepDm ? DM_LIMIT_WITH_BUTTONS : DM_LIMIT_PLAIN;
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
        commentReply,
        twoStepDm,
        secondDmMessage,
        unresolvedPrompt,
      },
    });
    await router.invalidate();
    onClose();
  });

  return (
    <Card
      title={initial ? "Изменить правило" : "Новое правило"}
      actions={
        <button className="btn-ghost text-xs" onClick={onClose}>
          Закрыть
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
          <Field label="Название">
            <input
              className="input"
              value={name}
              maxLength={120}
              required
              onChange={(e) => setName(e.target.value)}
              placeholder="Рилс про курс"
            />
          </Field>
          {data.accounts.length > 1 ? (
            <Field label="Аккаунт">
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
            <Field label="Срабатывает на">
              <select
                className="input"
                value={trigger}
                onChange={(e) => setTrigger(e.target.value as typeof trigger)}
              >
                <option value="comment">комментарии к посту</option>
                <option value="story_reply">ответы на сторис</option>
              </select>
            </Field>
          )}
        </div>
        {trigger === "comment" && (
          <Field
            label="Пост"
            hint="Правило на все посты требует ключевое слово — иначе бот ответит на любой комментарий."
          >
            <PostPicker accountId={accountId} value={target} onChange={setTarget} />
          </Field>
        )}
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem]">
          <Field label="Ключевые слова" hint="через запятую; регистр не важен">
            <input
              className="input"
              value={keywords}
              disabled={replyToAll && Boolean(target)}
              onChange={(e) => setKeywords(e.target.value)}
              placeholder="хочу, цена, +"
            />
          </Field>
          <Field label="Совпадение">
            <select
              className="input"
              value={matchMode}
              onChange={(e) => setMatchMode(e.target.value as typeof matchMode)}
            >
              <option value="contains">содержит</option>
              <option value="exact">точно</option>
            </select>
          </Field>
        </div>
        {target && (
          <div className="flex items-center gap-3">
            <Switch
              checked={replyToAll}
              onChange={setReplyToAll}
              label="Отвечать на любой комментарий"
            />
            <span className="text-sm">Отвечать на любой комментарий под этим постом</span>
          </div>
        )}
        <Field label="Сообщение в Direct" hint={`${dmMessage.length} / ${limit}`}>
          <textarea
            className="input min-h-28"
            value={dmMessage}
            maxLength={DM_LIMIT_PLAIN}
            required
            onChange={(e) => setDmMessage(e.target.value)}
            placeholder="Привет! Вот ссылка на материалы…"
          />
        </Field>
        <div>
          <span className="label">Кнопки под сообщением (до 3)</span>
          <ButtonsEditor
            buttons={buttons}
            onChange={setButtons}
            telegramUsername={data.telegramUsername}
          />
        </div>
        <div className="rounded-md border border-line p-3">
          <div className="flex items-center gap-3">
            <Switch checked={twoStepDm} onChange={setTwoStepDm} label="Два шага" />
            <span className="text-sm">
              Два шага: сначала текст без кнопок, кнопки — вторым сообщением
            </span>
          </div>
          <p className="mt-1 text-xs text-muted">
            Meta пессимизирует кнопки в первом сообщении незнакомому человеку. В этом режиме кнопки
            уходят вторым сообщением; если Direct ещё закрыт — сразу после первого ответа
            покупателя.
          </p>
          {twoStepDm && (
            <Field label="Текст второго сообщения">
              <input
                className="input mt-2"
                value={secondDmMessage}
                maxLength={1000}
                onChange={(e) => setSecondDmMessage(e.target.value)}
                placeholder="Для перехода в бот и получения материалов нажмите кнопку ниже 👇"
              />
            </Field>
          )}
        </div>
        <Field
          label="Публичный ответ под комментарием"
          hint="необязательно; например «Ответили в директ 💬»"
        >
          <input
            className="input"
            value={commentReply}
            maxLength={1000}
            onChange={(e) => setCommentReply(e.target.value)}
          />
        </Field>
        <Field
          label="Если DM не доставилась никак"
          hint="публичный ответ с просьбой написать первым — открывает окно Direct"
        >
          <input
            className="input"
            value={unresolvedPrompt}
            maxLength={500}
            onChange={(e) => setUnresolvedPrompt(e.target.value)}
            placeholder="Напишите нам в директ, и мы пришлём материалы 🙌"
          />
        </Field>
        <div className="flex items-center gap-3">
          <button className="btn-primary" disabled={save.busy || !dmMessage.trim() || !name.trim()}>
            {save.busy ? "Сохраняем…" : "Сохранить"}
          </button>
          {initial && (initial.platformPostId ?? null) !== (target?.platformPostId ?? null) && (
            <span className="text-xs text-warn">
              Смена поста пересоздаёт правило — счётчики обнулятся.
            </span>
          )}
        </div>
        <ErrorBox error={save.error} />
      </form>
    </Card>
  );
}

function CatchupCard({ data }: { data: Data }) {
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
    if (!confirm(`Отправить DM ${ids.length} людям?`)) return;
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
    if (!confirm(`Ответить публично под ${ids.length} комментариями?`)) return;
    const r = await catchupPublicFn({
      data: { accountId, postId, commentIds: ids, message: publicText },
    });
    setResults(r.results);
  });
  const resultOf = (id: string) => results.find((r) => r.commentId === id);

  return (
    <Card title="Догоняющая рассылка по комментариям">
      <p className="mb-3 text-sm text-muted">
        Если правило под постом замолчало, здесь видно, кому DM не ушла, и можно отправить её
        вручную — до 25 человек за раз.
      </p>
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
          <option value="">{posts === null ? "Загрузка постов…" : "Выберите пост"}</option>
          {(posts ?? []).map((p) => (
            <option key={p.platformPostId} value={p.platformPostId}>
              {[
                p.publishedAt ? new Date(p.publishedAt).toLocaleDateString("ru") : "",
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
          {load.busy ? "Загружаем…" : "Загрузить комментарии"}
        </button>
      </div>
      <ErrorBox error={load.error} />
      {loaded && (
        <div className="mt-3 space-y-3">
          {!loaded.automation && (
            <p className="text-xs text-warn">
              Под этим постом нет активного правила — статусы «пропущен» тут не считаются.
            </p>
          )}
          <p className="text-xs text-muted">
            Комментариев: {loaded.comments.length} · выбрано {selected.size}
            <button
              className="btn-ghost ml-2 text-xs"
              onClick={() => setSelected(new Set(loaded.comments.map((c) => c.id)))}
            >
              все
            </button>
            <button className="btn-ghost text-xs" onClick={() => setSelected(new Set())}>
              никого
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
                      <Badge tone={st.tone}>{st.label}</Badge>
                      {c.blockReason && (
                        <span className="text-xs text-muted">{BLOCK_REASON[c.blockReason]}</span>
                      )}
                      {r && (
                        <Badge tone={r.ok ? "ok" : "danger"}>
                          {r.ok ? "отправлено" : "ошибка"}
                        </Badge>
                      )}
                      {c.createdTime && (
                        <span className="text-xs text-muted">
                          {new Date(c.createdTime).toLocaleString("ru")}
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
          <Field label="Текст DM">
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
            {sendPrivate.busy ? "Отправляем…" : `Отправить DM (${ids.length})`}
          </button>
          <ErrorBox error={sendPrivate.error} />
          <Field label="Публичный ответ под комментарием" hint="отдельное действие, свой текст">
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
            {sendPublic.busy ? "Отвечаем…" : `Ответить публично (${ids.length})`}
          </button>
          <ErrorBox error={sendPublic.error} />
        </div>
      )}
    </Card>
  );
}

function FallbackJournal({ rows }: { rows: Data["fallbackSends"] }) {
  if (rows.length === 0) return null;
  return (
    <Card title="Резервные отправки">
      <p className="mb-2 text-xs text-muted">
        Крон раз в 15 минут дошлёт DM тем, кого правило Zernio пропустило.
      </p>
      <ul className="divide-y divide-line text-xs">
        {rows.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-2 py-1.5">
            <Badge tone={r.status === "sent" ? "ok" : r.status === "failed" ? "danger" : "warn"}>
              {r.status}
            </Badge>
            <span className="text-muted">{new Date(r.created_at).toLocaleString("ru")}</span>
            <span>комментарий {r.comment_id}</span>
            {r.alt_channel_status === "sent" && <span className="text-ok">через диалог</span>}
            {r.comment_reply_status === "sent" && <span>+ публичный ответ</span>}
            {r.comment_reply_error === "prompt_sent" && <span>+ просьба написать</span>}
            {r.error && <span className="text-danger">{r.error.slice(0, 160)}</span>}
          </li>
        ))}
      </ul>
    </Card>
  );
}
