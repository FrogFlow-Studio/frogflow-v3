import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type ReactElement } from "react";
import { pricelistFn, savePricelistArticlesFn } from "@/app/admin/pricelist.functions";
import { KnowledgeImport } from "@/app/admin/pricelist-cards";
import { Badge, Empty, ErrorBox, Field, PageTitle, useAction } from "@/app/ui";
import { adminT, intlLocale, type AdminT } from "@/app/i18n/admin";
import { canEdit } from "@/core/auth/roles";

/**
 * «База знаний» консультанта по прайсу: статьи, которые консультант
 * подкладывает к вопросу покупателя (по тегам и словам). Те же статьи и та же
 * запись, что в карточке «База знаний» на странице прайса
 * (`savePricelistArticlesFn`), только по одной: открыта одна статья, сохраняется
 * она одна поверх списка, загруженного со страницей.
 */
export const Route = createFileRoute("/admin/_authed/knowledge")({
  beforeLoad: ({ context }) => {
    if (!context.shop.pricelist) throw redirect({ to: "/admin" });
  },
  loader: () => pricelistFn(),
  component: KnowledgePage,
});

type Article = Awaited<ReturnType<typeof pricelistFn>>["articles"][number];
type Draft = { id: string; title: string; tags: string; content: string };

const NEW = "__new__";
const tagsOf = (s: string) =>
  s
    .split(/[,;\n]/)
    .map((x) => x.trim())
    .filter(Boolean);

function KnowledgePage(): ReactElement {
  const data = Route.useLoaderData();
  const { shop } = Route.useRouteContext();
  const router = useRouter();
  const t = adminT(shop.locale);
  const loc = intlLocale(shop.locale);
  const editable = canEdit(shop.role);
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saved, setSaved] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const original = (id: string): Article | undefined => data.articles.find((a) => a.id === id);
  const toDraft = (a: Article): Draft => ({
    id: a.id,
    title: a.title,
    tags: a.tags.join(", "),
    content: a.content,
  });
  const dirty =
    draft !== null &&
    (draft.id === NEW
      ? Boolean(draft.title.trim() || draft.content.trim())
      : JSON.stringify(draft) !== JSON.stringify(toDraft(original(draft.id)!)));

  // Список обновился после сохранения или загрузки — открытая статья берётся заново.
  useEffect(() => {
    if (openId && openId !== NEW && !data.articles.some((a) => a.id === openId)) {
      setOpenId(null);
      setDraft(null);
    }
  }, [data.articles, openId]);

  const open = (id: string | null) => {
    setSaved(false);
    setConfirmDelete(false);
    if (id === null || id === openId) {
      setOpenId(null);
      setDraft(null);
      return;
    }
    setOpenId(id);
    const a = id === NEW ? null : original(id);
    setDraft(a ? toDraft(a) : { id: NEW, title: "", tags: "", content: "" });
  };

  const write = async (
    list: Array<{ id?: string; title: string; tags: string[]; content: string }>,
  ) => {
    await savePricelistArticlesFn({ data: { articles: list } });
    await router.invalidate();
  };
  const save = useAction(async () => {
    if (!draft) return;
    const mine = { title: draft.title, tags: tagsOf(draft.tags), content: draft.content };
    const rest = data.articles.map((a) => ({
      id: a.id,
      title: a.title,
      tags: a.tags,
      content: a.content,
    }));
    await write(
      draft.id === NEW
        ? [...rest, mine]
        : rest.map((a) => (a.id === draft.id ? { id: a.id, ...mine } : a)),
    );
    setSaved(true);
    if (draft.id === NEW) {
      setOpenId(null);
      setDraft(null);
    }
  });
  const remove = useAction(async () => {
    if (!draft || draft.id === NEW) return;
    await write(
      data.articles
        .filter((a) => a.id !== draft.id)
        .map((a) => ({ id: a.id, title: a.title, tags: a.tags, content: a.content })),
    );
    setOpenId(null);
    setDraft(null);
  });

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return data.articles;
    return data.articles.filter((a) =>
      [a.title, a.tags.join(" "), a.content].some((s) => s.toLowerCase().includes(q)),
    );
  }, [data.articles, query]);
  const date = (iso: string) => new Date(iso).toLocaleDateString(loc, { dateStyle: "medium" });

  return (
    <>
      <PageTitle
        title={t("ws.kb.title")}
        subtitle={t("ws.kb.subtitle", { n: data.articles.length })}
        actions={
          editable ? (
            <button className="btn-primary" disabled={dirty} onClick={() => open(NEW)}>
              {t("ws.kb.new")}
            </button>
          ) : undefined
        }
      />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] [&>*]:min-w-0">
        <div className="space-y-3">
          <Field label={t("ws.kb.search")}>
            <input
              className="input"
              type="search"
              value={query}
              placeholder={t("ws.kb.searchPlaceholder")}
              onChange={(e) => setQuery(e.target.value)}
            />
          </Field>
          {dirty && <p className="text-sm text-warn">{t("ws.kb.dirty")}</p>}
          {saved && <p className="text-sm text-ok">{t("ws.kb.saved")}</p>}
          {openId === NEW && draft && (
            <div className="card p-4">
              <Editor
                t={t}
                draft={draft}
                setDraft={setDraft}
                editable={editable}
                busy={save.busy}
                onSave={() => void save.run().catch(() => {})}
              />
            </div>
          )}
          {data.articles.length === 0 && openId !== NEW && <Empty>{t("ws.kb.empty")}</Empty>}
          {data.articles.length > 0 && shown.length === 0 && <Empty>{t("ws.kb.nothing")}</Empty>}
          <ul className="space-y-2">
            {shown.map((a) => {
              const isOpen = openId === a.id;
              return (
                <li key={a.id} className="card" data-testid="kb-article">
                  <button
                    type="button"
                    className="flex w-full flex-wrap items-center gap-2 px-4 py-3 text-left"
                    aria-expanded={isOpen}
                    disabled={dirty && !isOpen}
                    onClick={() => open(a.id)}
                  >
                    <span className="min-w-0 flex-1 font-medium">
                      {a.title || t("ws.kb.untitled")}
                    </span>
                    {a.tags.length > 0 ? (
                      <span className="text-xs text-muted">#{a.tags.join(" #")}</span>
                    ) : (
                      <Badge tone="warn">{t("ws.kb.noTags")}</Badge>
                    )}
                    {a.updatedAt && <span className="text-xs text-muted">{date(a.updatedAt)}</span>}
                  </button>
                  {isOpen && draft && (
                    <div className="border-t border-line p-4">
                      <Editor
                        t={t}
                        draft={draft}
                        setDraft={setDraft}
                        editable={editable}
                        busy={save.busy || remove.busy}
                        onSave={() => void save.run().catch(() => {})}
                      />
                      {editable && (
                        <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-line pt-3">
                          {confirmDelete ? (
                            <>
                              <span className="min-w-0 flex-1 text-sm">
                                {t("ws.kb.deleteConfirm", { title: a.title })}
                              </span>
                              <button
                                className="btn-danger text-sm"
                                disabled={remove.busy}
                                onClick={() => void remove.run().catch(() => {})}
                              >
                                {t("common.delete")}
                              </button>
                              <button
                                className="btn-ghost text-sm"
                                onClick={() => setConfirmDelete(false)}
                              >
                                {t("common.cancel")}
                              </button>
                            </>
                          ) : (
                            <button
                              className="btn-ghost text-sm text-danger"
                              onClick={() => setConfirmDelete(true)}
                            >
                              {t("ws.kb.delete")}
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          <ErrorBox error={save.error ?? remove.error} />
        </div>
        {editable && (
          <div>
            <KnowledgeImport
              t={t}
              dirty={dirty}
              onDone={async () => {
                await router.invalidate();
              }}
            />
          </div>
        )}
      </div>
    </>
  );
}

function Editor({
  t,
  draft,
  setDraft,
  editable,
  busy,
  onSave,
}: {
  t: AdminT;
  draft: Draft;
  setDraft: (d: Draft) => void;
  editable: boolean;
  busy: boolean;
  onSave: () => void;
}) {
  return (
    <div className="space-y-3">
      <Field label={t("ws.kb.titleLabel")}>
        <input
          className="input"
          value={draft.title}
          disabled={!editable}
          maxLength={200}
          onChange={(e) => setDraft({ ...draft, title: e.target.value })}
        />
      </Field>
      <Field label={t("ws.kb.tags")} hint={t("ws.kb.tagsHint")}>
        <input
          className="input"
          value={draft.tags}
          disabled={!editable}
          onChange={(e) => setDraft({ ...draft, tags: e.target.value })}
        />
      </Field>
      <Field label={t("ws.kb.content")}>
        <textarea
          className="input min-h-40 text-sm"
          value={draft.content}
          disabled={!editable}
          onChange={(e) => setDraft({ ...draft, content: e.target.value })}
        />
      </Field>
      {editable && (
        <button
          className="btn-primary"
          disabled={busy || !draft.title.trim() || !draft.content.trim()}
          onClick={onSave}
        >
          {t("ws.kb.save")}
        </button>
      )}
    </div>
  );
}
