import { useEffect, useState } from "react";
import {
  addKnowledgeArticlesFn,
  previewKnowledgeImportFn,
  savePricelistArticlesFn,
} from "../pricelist.functions";
import { Badge, Card, ErrorBox, Field, useAction } from "@/app/ui";
import { type AdminT } from "@/app/i18n/admin";
import { KNOWLEDGE_FILE_MAX_MB } from "@/core/consultant/pricelist/knowledge-import";
import { type CardProps, type Data } from "./shared";
import { HelpTip } from "@/app/admin/help-panel";

/** База знаний: статьи и импорт. */

export function KnowledgeCard({ t, data, canEdit, onDone }: CardProps) {
  // После загрузки статей список правки берётся из базы заново (новый ключ),
  // когда страница получила свежие статьи.
  const [version, setVersion] = useState(0);
  const [dirty, setDirty] = useState(false);
  // Статьи, которые были на странице до загрузки: ждём, пока придут другие.
  const [staleArticles, setStaleArticles] = useState<Data["articles"] | null>(null);
  useEffect(() => {
    if (!staleArticles || data.articles === staleArticles) return;
    setStaleArticles(null);
    setDirty(false);
    setVersion((v) => v + 1);
  }, [data.articles, staleArticles]);
  return (
    <Card title={t("pricelist.kb.title")} help={<HelpTip article="pricelist" anchor="knowledge" />}>
      <p className="mb-3 text-sm text-muted">{t("pricelist.kb.hint")}</p>
      {canEdit && (
        <KnowledgeImport
          t={t}
          dirty={dirty}
          onDone={async () => {
            setStaleArticles(data.articles);
            await onDone();
          }}
        />
      )}
      <ArticlesEditor
        key={version}
        t={t}
        data={data}
        canEdit={canEdit}
        onDone={onDone}
        onDirty={setDirty}
      />
    </Card>
  );
}

export function ArticlesEditor({
  t,
  data,
  canEdit,
  onDone,
  onDirty,
}: CardProps & { onDirty: (dirty: boolean) => void }) {
  const [articles, setArticles] = useState(data.articles);
  useEffect(() => {
    onDirty(JSON.stringify(articles) !== JSON.stringify(data.articles));
  }, [articles, data.articles, onDirty]);
  const [saved, setSaved] = useState(false);
  const save = useAction(async () => {
    setSaved(false);
    await savePricelistArticlesFn({ data: { articles } });
    setSaved(true);
    await onDone();
  });
  const set = (i: number, patch: Partial<(typeof articles)[number]>) =>
    setArticles((as) => as.map((a, j) => (j === i ? { ...a, ...patch } : a)));
  return (
    <>
      <div className="space-y-3">
        {articles.map((a, i) => (
          <div key={a.id || i} className="rounded-md border border-line p-3">
            <Field label={t("pricelist.kb.articleTitle")}>
              <input
                className="input"
                value={a.title}
                disabled={!canEdit}
                onChange={(e) => set(i, { title: e.target.value })}
              />
            </Field>
            <Field label={t("pricelist.kb.content")}>
              <textarea
                className="input min-h-24 text-sm"
                value={a.content}
                disabled={!canEdit}
                onChange={(e) => set(i, { content: e.target.value })}
              />
            </Field>
            {canEdit && (
              <button
                className="btn-ghost text-xs text-danger"
                onClick={() => setArticles((as) => as.filter((_, j) => j !== i))}
              >
                {t("pricelist.delete")}
              </button>
            )}
          </div>
        ))}
      </div>
      {canEdit && (
        <div className="mt-3 flex items-center gap-3">
          <button
            className="btn-secondary"
            onClick={() =>
              setArticles((as) => [
                ...as,
                { id: "", title: "", tags: [], content: "", updatedAt: "" },
              ])
            }
          >
            {t("pricelist.kb.add")}
          </button>
          <button
            className="btn-primary"
            disabled={save.busy}
            onClick={() => void save.run().catch(() => {})}
          >
            {t("pricelist.save")}
          </button>
          {saved && <span className="text-sm text-ok">{t("pricelist.saved")}</span>}
        </div>
      )}
      <ErrorBox error={save.error} />
    </>
  );
}

export type KbPreview = Awaited<ReturnType<typeof previewKnowledgeImportFn>>;

export function fileBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error ?? new Error("read"));
    r.readAsDataURL(file);
  });
}

/**
 * Загрузка статей из PDF, Word, .txt/.md или вставленного текста: сначала
 * предпросмотр, в базу — только отмеченные; прежние статьи остаются.
 */
export function KnowledgeImport({
  t,
  dirty,
  onDone,
}: {
  t: AdminT;
  dirty: boolean;
  onDone: () => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<KbPreview | null>(null);
  const [chosen, setChosen] = useState<boolean[]>([]);
  const [tooBig, setTooBig] = useState(false);
  const [done, setDone] = useState<{ added: number; updated: number; total: number } | null>(null);
  const show = (p: KbPreview) => {
    setPreview(p);
    setChosen(p.articles.map(() => true));
    setDone(null);
  };
  const fromFile = useAction(async (file: File) => {
    setPreview(null);
    setTooBig(file.size > KNOWLEDGE_FILE_MAX_MB * 1024 * 1024);
    if (file.size > KNOWLEDGE_FILE_MAX_MB * 1024 * 1024) return;
    const base64 = await fileBase64(file);
    show(await previewKnowledgeImportFn({ data: { fileName: file.name, base64 } }));
  });
  const fromText = useAction(async () => {
    setPreview(null);
    setTooBig(false);
    show(await previewKnowledgeImportFn({ data: { text } }));
  });
  const add = useAction(async () => {
    if (!preview) return;
    const articles = preview.articles
      .filter((_, i) => chosen[i])
      .map(({ title, tags, content }) => ({ title, tags, content }));
    const r = await addKnowledgeArticlesFn({ data: { articles } });
    setPreview(null);
    setText("");
    setDone(r);
    await onDone();
  });
  const count = chosen.filter(Boolean).length;
  return (
    <div className="mb-4 rounded-md border border-line p-3">
      <div className="mb-1 flex items-center gap-1.5 text-sm font-medium">
        {t("pricelist.kb.import.title")}
        <HelpTip article="knowledge" anchor="import" />
      </div>
      <p className="mb-3 text-xs text-muted">
        {t("pricelist.kb.import.hint", { mb: KNOWLEDGE_FILE_MAX_MB })}
      </p>
      <label className="btn-secondary inline-block cursor-pointer">
        {t("pricelist.kb.import.file")}
        <input
          type="file"
          accept=".pdf,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown"
          className="hidden"
          disabled={fromFile.busy}
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void fromFile.run(f).catch(() => {});
          }}
        />
      </label>
      {tooBig && (
        <p className="mt-2 text-sm text-danger">
          {t("pricelist.kb.import.tooBig", { mb: KNOWLEDGE_FILE_MAX_MB })}
        </p>
      )}
      <Field label={t("pricelist.kb.import.text")}>
        <textarea
          className="input min-h-24 text-sm"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </Field>
      <button
        className="btn-secondary"
        disabled={fromText.busy || !text.trim()}
        onClick={() => void fromText.run().catch(() => {})}
      >
        {t("pricelist.kb.import.preview")}
      </button>
      {preview && (
        <div className="mt-3 space-y-2 text-sm">
          <p>{t("pricelist.kb.import.found", { count: preview.articles.length })}</p>
          {preview.truncated > 0 && (
            <p className="text-warn">
              {t("pricelist.kb.import.truncated", {
                count: preview.truncated,
                max: preview.maxChars,
              })}
            </p>
          )}
          <ul className="space-y-2">
            {preview.articles.map((a, i) => (
              <li key={i} className="rounded-md border border-line p-2">
                <label className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={chosen[i] ?? false}
                    onChange={(e) =>
                      setChosen((c) => c.map((v, j) => (j === i ? e.target.checked : v)))
                    }
                  />
                  <span className="min-w-0">
                    <span className="font-medium">{a.title}</span>{" "}
                    <Badge tone={a.replaces ? "warn" : "ok"}>
                      {a.replaces
                        ? t("pricelist.kb.import.replaces")
                        : t("pricelist.kb.import.new")}
                    </Badge>
                    {a.tags.length > 0 && (
                      <span className="block text-xs text-muted">#{a.tags.join(" #")}</span>
                    )}
                    <span className="block whitespace-pre-line text-xs text-muted">
                      {a.content.length > 300 ? `${a.content.slice(0, 300)}…` : a.content}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
          {dirty && <p className="text-warn">{t("pricelist.kb.import.saveFirst")}</p>}
          <div className="flex gap-2">
            <button
              className="btn-primary"
              disabled={add.busy || count === 0 || dirty}
              onClick={() => void add.run().catch(() => {})}
            >
              {t("pricelist.kb.import.add", { count })}
            </button>
            <button className="btn-ghost" onClick={() => setPreview(null)}>
              {t("pricelist.kb.import.cancel")}
            </button>
          </div>
        </div>
      )}
      {done && <p className="mt-2 text-sm text-ok">{t("pricelist.kb.import.done", done)}</p>}
      <ErrorBox error={fromFile.error ?? fromText.error ?? add.error} />
    </div>
  );
}
