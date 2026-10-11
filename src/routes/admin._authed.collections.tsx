import { HelpTip } from "@/app/admin/help-panel";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import {
  collectionsFn,
  deleteCollectionFn,
  saveCollectionFn,
} from "@/app/admin/collections.functions";
import { ProductSearch } from "@/app/admin/product-picker";
import { adminT } from "@/app/i18n/admin";
import { Card, Empty, ErrorBox, Field, PageTitle, useAction } from "@/app/ui";
import { COLLECTION_PRODUCTS_MAX } from "@/core/storefront/collections";

export const Route = createFileRoute("/admin/_authed/collections")({
  loader: () => collectionsFn(),
  component: CollectionsPage,
});

type Item = { id: string; name: string; state: "ok" | "hidden" | "gone" };
type Draft = { id?: string; name: string; products: Item[] };

/** Подборки (В15): список со ссылками и форма «название + товары поиском». */
function CollectionsPage() {
  const list = Route.useLoaderData();
  const { shop } = Route.useRouteContext();
  const t = adminT(shop.locale);
  const router = useRouter();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [note, setNote] = useState("");
  const save = useAction(async () => {
    if (!draft) return;
    await saveCollectionFn({
      data: { id: draft.id, name: draft.name, productIds: draft.products.map((p) => p.id) },
    });
    setDraft(null);
    setNote(t("collections.saved"));
    await router.invalidate();
  });
  const remove = useAction(async (id: string) => {
    await deleteCollectionFn({ data: { id } });
    await router.invalidate();
  });
  const copy = useAction(async (url: string) => {
    await navigator.clipboard.writeText(url);
    setNote(t("collections.copied"));
  });
  return (
    <>
      <PageTitle title={t("collections.title")} subtitle={t("collections.subtitle")} />
      {note && <p className="mb-3 rounded-md bg-ok/10 px-3 py-2 text-sm text-ok">{note}</p>}
      <div className="space-y-4">
        {list.length === 0 && !draft && <Empty>{t("collections.empty")}</Empty>}
        {list.map((c) => (
          <Card
            key={c.id}
            title={c.name}
            actions={
              <span className="text-xs text-muted">
                {t("collections.count", { n: c.products.length })}
              </span>
            }
          >
            {c.url && (
              <p className="mb-3 break-all text-sm">
                <span className="text-muted">
                  {t("collections.link")}
                  <HelpTip article="collections" anchor="link" />:{" "}
                </span>
                <a href={c.url} target="_blank" rel="noreferrer" className="text-accent underline">
                  {c.url}
                </a>
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              {c.url && (
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => void copy.run(c.url!).catch(() => {})}
                >
                  {t("collections.copy")}
                </button>
              )}
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  setNote("");
                  setDraft({ id: c.id, name: c.name, products: c.products });
                }}
              >
                {t("collections.edit")}
              </button>
              <button
                type="button"
                className="btn-secondary text-danger"
                onClick={() => {
                  if (confirm(t("collections.deleteConfirm", { name: c.name })))
                    void remove.run(c.id).catch(() => {});
                }}
              >
                {t("collections.delete")}
              </button>
            </div>
          </Card>
        ))}
        <ErrorBox error={remove.error ?? copy.error} />
        {draft ? (
          <Card title={draft.id ? t("collections.edit") : t("collections.new")}>
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                void save.run().catch(() => {});
              }}
            >
              <Field
                label={t("collections.name")}
                help={<HelpTip article="collections" anchor="form" />}
              >
                <input
                  className="input"
                  value={draft.name}
                  maxLength={80}
                  placeholder={t("collections.namePlaceholder")}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </Field>
              <Field label={t("collections.products")}>
                <ul className="mb-2 space-y-1 text-sm">
                  {draft.products.length === 0 && (
                    <li className="text-muted">{t("collections.noProducts")}</li>
                  )}
                  {draft.products.map((p) => (
                    <li key={p.id} className="flex items-center justify-between gap-2">
                      <span>
                        {p.name || t("collections.gone")}
                        {p.state === "hidden" && (
                          <span className="ml-2 text-xs text-muted">
                            {t("collections.hiddenNow")}
                          </span>
                        )}
                      </span>
                      <button
                        type="button"
                        className="text-xs text-danger hover:underline"
                        onClick={() =>
                          setDraft({
                            ...draft,
                            products: draft.products.filter((x) => x.id !== p.id),
                          })
                        }
                      >
                        {t("collections.remove")}
                      </button>
                    </li>
                  ))}
                </ul>
                {draft.products.length < COLLECTION_PRODUCTS_MAX && (
                  <ProductSearch
                    t={t}
                    exclude={draft.products.map((p) => p.id)}
                    onPick={(p) =>
                      setDraft({
                        ...draft,
                        products: [...draft.products, { id: p.id, name: p.name, state: "ok" }],
                      })
                    }
                  />
                )}
              </Field>
              <ErrorBox error={save.error} />
              <div className="flex gap-2">
                <button className="btn-primary" disabled={save.busy}>
                  {t("collections.save")}
                </button>
                <button type="button" className="btn-secondary" onClick={() => setDraft(null)}>
                  {t("collections.cancel")}
                </button>
              </div>
            </form>
          </Card>
        ) : (
          <button
            type="button"
            className="btn-primary"
            onClick={() => {
              setNote("");
              setDraft({ name: "", products: [] });
            }}
          >
            {t("collections.new")}
          </button>
        )}
      </div>
    </>
  );
}
