import { Link, useRouteContext, useRouter } from "@tanstack/react-router";
import { useEffect, useState, type RefObject } from "react";
import {
  instagramPostsFn,
  saveAutomationFn,
  syncInstagramPostFn,
} from "@/app/admin/instagram.functions";
import { ProductSearch } from "@/app/admin/product-picker";
import {
  copyRuleFormValues,
  RULE_NAME_MAX,
  ruleFormDirty,
  ruleFormValues,
  type RuleFormValues,
  type RuleTarget,
} from "@/app/admin/instagram-rule-form";
import { HelpTip } from "@/app/admin/help-panel";
import { Card, ErrorBox, Field, Switch, useAction } from "@/app/ui";
import {
  buyButtonProductIds,
  DM_LIMIT_PLAIN,
  isGenericDmKeyword,
  productMentionedInCaption,
  sharedRuleKeywords,
  withReplyPrompt,
} from "@/core/instagram/comment-rules";
import { type Button, type Data, type Editing, type Post, useAdminI18n } from "./shared";

/** Форма правила: выбор поста, кнопки, тексты. */

export function usePosts(accountId: string) {
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
  onProductPicked,
  telegramUsername,
}: {
  buttons: Button[];
  onChange: (b: Button[]) => void;
  onProductPicked: (p: { id: string; name: string }) => void;
  telegramUsername: string | null;
}) {
  const { t } = useAdminI18n();
  const { shop } = useRouteContext({ from: "/admin/_authed" });
  // Консультант без продаж: кнопка «Купить» открыла бы карточку из пустого каталога.
  const sells = shop.sells !== false;
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
          {sells && (
            <button
              type="button"
              className="btn-secondary text-xs"
              onClick={() => setPicking((v) => !v)}
            >
              {t("instagram.buttons.addProduct")}
            </button>
          )}
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
      {!sells && (
        <p className="text-xs text-muted">
          {t("instagram.buttons.productConsultant", { section: t("consultant.stories.title") })}{" "}
          <Link to="/admin/consultant" className="text-accent hover:underline">
            {t("instagram.buttons.productConsultantLink")}
          </Link>
        </p>
      )}
      {sells && picking && buttons.length < 3 && (
        <div className="space-y-1">
          <p className="flex items-center gap-1.5 text-xs text-muted">
            {t("instagram.buttons.productHint")}
            <HelpTip article="instagram" anchor="buy-button" />
          </p>
          <ProductSearch
            t={t}
            autoFocus
            onPick={(p) => {
              onProductPicked(p);
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

export function RuleForm({
  data,
  editing,
  dirtyRef,
  onClose,
  onSaved,
}: {
  data: Data;
  editing: Editing;
  /** Сюда форма пишет, есть ли несохранённые изменения (спросить перед заменой). */
  dirtyRef: RefObject<boolean>;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const router = useRouter();
  const { t } = useAdminI18n();
  // Правка существующего правила; у копии и нового правила id нет — сохраняются созданием.
  const initial = editing.kind === "edit" ? editing.rule : null;
  const [init] = useState<RuleFormValues>(() =>
    editing.kind === "copy"
      ? copyRuleFormValues(editing.rule, (name) => t("instagram.form.copyName", { name }))
      : ruleFormValues(initial, data.accounts[0]!.id),
  );
  const [accountId, setAccountId] = useState(init.accountId);
  const [name, setName] = useState(init.name);
  const [trigger, setTrigger] = useState<"comment" | "story_reply">(init.trigger);
  const [target, setTarget] = useState<RuleTarget | null>(init.target);
  const [keywords, setKeywords] = useState(init.keywords);
  const [replyToAll, setReplyToAll] = useState(init.replyToAll);
  const [matchMode, setMatchMode] = useState<"exact" | "contains">(init.matchMode);
  const [dmMessage, setDmMessage] = useState(init.dmMessage);
  const [buttons, setButtons] = useState<Button[]>(init.buttons);
  // Публичный ответ: основной и варианты — Zernio чередует их, чтобы одинаковые
  // ответы под постом не выглядели как спам.
  const [commentReplies, setCommentReplies] = useState<string[]>(init.commentReplies);
  const [twoStepDm, setTwoStepDm] = useState(init.twoStepDm);
  const [secondDmMessage, setSecondDmMessage] = useState(init.secondDmMessage);
  const [unresolvedPrompt, setUnresolvedPrompt] = useState(init.unresolvedPrompt);
  const [replyPrompt, setReplyPrompt] = useState(init.replyPrompt);
  // Названия товаров кнопок «Купить»: сохранённых правил — с сервера, новых — из поиска.
  const [productNames, setProductNames] = useState<Record<string, string>>(data.productNames);
  // Порядок полей — как в ruleFormValues: сравнение идёт по JSON.
  const current: RuleFormValues = {
    accountId,
    name,
    trigger,
    target,
    keywords,
    replyToAll,
    matchMode,
    dmMessage,
    buttons,
    commentReplies,
    twoStepDm,
    secondDmMessage,
    unresolvedPrompt,
    replyPrompt,
  };
  useEffect(() => {
    dirtyRef.current = ruleFormDirty(current, init);
  });

  // Кнопки всегда уходят вторым сообщением (первое — private-reply без кнопок),
  // поэтому с кнопками два шага включены всегда.
  const twoStepOn = twoStepDm || buttons.length > 0;
  const limit = DM_LIMIT_PLAIN;
  // Предел — у первого сообщения целиком, вместе с призывом ответить.
  const firstLength = (twoStepOn ? withReplyPrompt(dmMessage, replyPrompt) : dmMessage).length;
  const parsedKeywords = keywords
    .split(/[,\n;]+/)
    .map((k) => k.trim())
    .filter(Boolean);
  const activeKeywords = replyToAll && Boolean(target) ? [] : parsedKeywords;
  // Товар «Купить» не упомянут в подписи поста — скорее всего, выбран не тот (Копилка, #126).
  const productWarnings =
    trigger === "comment" && target?.title
      ? buyButtonProductIds(buttons)
          .map((id) => productNames[id])
          .filter((n): n is string => Boolean(n))
          .filter((n) => !productMentionedInCaption(n, target.title))
          .map((n) =>
            t("instagram.form.productNotInPost", {
              product: n,
              post: target.title.length > 60 ? `${target.title.slice(0, 60)}…` : target.title,
            }),
          )
      : [];
  // Пересечение или слишком общие кодовые слова («+», «нужно»): под постом работают,
  // но в Direct без комментария бот не угадает товар (AATeach, #1597).
  const sharedKeywords =
    trigger === "comment"
      ? sharedRuleKeywords(activeKeywords, data.automations, { id: initial?.id, accountId })
      : [];
  const sharedKeywordSet = new Set(
    sharedKeywords.map((s) => s.keyword.toLowerCase().replace(/ё/g, "е")),
  );
  const genericKeywords =
    trigger === "comment"
      ? Array.from(
          new Map(
            activeKeywords
              .filter(
                (k) =>
                  isGenericDmKeyword(k) &&
                  !sharedKeywordSet.has(k.toLowerCase().replace(/ё/g, "е")),
              )
              .map((k) => [k.toLowerCase().replace(/ё/g, "е"), k]),
          ).values(),
        )
      : [];
  const keywordWarnings = [
    ...sharedKeywords.map(({ keyword, rules }) =>
      t("instagram.form.keywordShared", {
        keyword,
        rules:
          rules
            .slice(0, 3)
            .map((r) => `«${r}»`)
            .join(", ") + (rules.length > 3 ? ` (+${rules.length - 3})` : ""),
      }),
    ),
    ...genericKeywords.map((keyword) => t("instagram.form.keywordGeneric", { keyword })),
  ];
  const save = useAction(async () => {
    const saved = await saveAutomationFn({
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
        keywords: parsedKeywords,
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
    onSaved(saved.id);
  });

  return (
    <Card
      title={
        initial
          ? t("instagram.form.editTitle")
          : editing.kind === "copy"
            ? t("instagram.form.copyTitle")
            : t("instagram.form.newTitle")
      }
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
        {editing.kind === "copy" && (
          <p className="text-sm text-muted">
            {t("instagram.form.copyHint", { name: editing.rule.name })}
          </p>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("instagram.form.name")}>
            <input
              className="input"
              value={name}
              maxLength={RULE_NAME_MAX}
              required
              onChange={(e) => setName(e.target.value)}
              placeholder={t("instagram.form.namePlaceholder")}
            />
          </Field>
          {data.accounts.length > 1 ? (
            <Field
              label={t("instagram.form.account")}
              help={<HelpTip article="instagram" anchor="trigger" />}
            >
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
            <Field
              label={t("instagram.form.trigger")}
              help={<HelpTip article="instagram" anchor="trigger" />}
            >
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
          <Field
            label={t("instagram.form.post")}
            hint={t("instagram.form.postHint")}
            help={<HelpTip article="instagram" anchor="post" />}
          >
            <PostPicker accountId={accountId} value={target} onChange={setTarget} />
          </Field>
        )}
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem]">
          <Field
            label={t("instagram.form.keywords")}
            hint={t("instagram.form.keywordsHint")}
            help={<HelpTip article="instagram" anchor="keywords" />}
          >
            <input
              className="input"
              value={keywords}
              disabled={replyToAll && Boolean(target)}
              onChange={(e) => setKeywords(e.target.value)}
              placeholder={t("instagram.form.keywordsPlaceholder")}
            />
          </Field>
          <Field
            label={t("instagram.form.match")}
            help={<HelpTip article="instagram" anchor="keywords" />}
          >
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
            <HelpTip article="instagram" anchor="reply-to-all" />
          </div>
        )}
        <Field
          label={t("instagram.form.dmMessage")}
          hint={`${firstLength} / ${limit}`}
          help={<HelpTip article="instagram" anchor="dm-message" />}
        >
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
          <span className="label flex items-center gap-1.5">
            {t("instagram.form.buttons")}
            <HelpTip article="instagram" anchor="buttons" />
          </span>
          <ButtonsEditor
            buttons={buttons}
            onChange={setButtons}
            onProductPicked={(p) => setProductNames((m) => ({ ...m, [p.id]: p.name }))}
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
            <HelpTip article="instagram" anchor="two-step" />
          </div>
          <p className="mt-1 text-xs text-muted">{t("instagram.form.twoStepHint")}</p>
          {twoStepOn && (
            <Field
              label={t("instagram.form.replyPrompt")}
              hint={t("instagram.form.replyPromptHint")}
              help={<HelpTip article="instagram" anchor="reply-prompt" />}
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
            <Field
              label={t("instagram.form.secondDm")}
              help={<HelpTip article="instagram" anchor="second-dm" />}
            >
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
        <Field
          label={t("instagram.form.commentReply")}
          hint={t("instagram.form.commentReplyHint")}
          help={<HelpTip article="instagram" anchor="comment-reply" />}
        >
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
        <Field
          label={t("instagram.form.unresolved")}
          hint={t("instagram.form.unresolvedHint")}
          help={<HelpTip article="instagram" anchor="unresolved" />}
        >
          <input
            className="input"
            value={unresolvedPrompt}
            maxLength={500}
            onChange={(e) => setUnresolvedPrompt(e.target.value)}
            placeholder={t("instagram.form.unresolvedPlaceholder")}
          />
        </Field>
        {[...productWarnings, ...keywordWarnings].map((w) => (
          <p key={w} className="text-sm text-warn" role="status">
            {w}
          </p>
        ))}
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
