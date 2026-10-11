import { HelpTip } from "@/app/admin/help-panel";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { igImportCandidatesFn, igImportFn } from "@/app/admin/posts.functions";
import { adminT } from "@/app/i18n/admin";
import { Card, Empty, ErrorBox, PageTitle, useAction } from "@/app/ui";

export const Route = createFileRoute("/admin/_authed/ig-import")({
  loader: () => igImportCandidatesFn(),
  component: IgImportPage,
});

type Row = { on: boolean; name: string; price: string };

function IgImportPage() {
  const data = Route.useLoaderData();
  const { shop } = Route.useRouteContext();
  const t = adminT(shop.locale);
  const router = useRouter();
  const posts = data.configured ? data.posts : [];
  const physicalNiche = shop.vertical === "confectionery" || shop.vertical === "flowers";
  const [kind, setKind] = useState<"digital" | "physical">(physicalNiche ? "physical" : "digital");
  const [categoryId, setCategoryId] = useState("");
  const [done, setDone] = useState<string | null>(null);
  const [rows, setRows] = useState<Record<string, Row>>(() =>
    Object.fromEntries(
      posts.map((p) => [
        p.postId,
        { on: p.draft.price !== null, name: p.draft.name, price: String(p.draft.price ?? "") },
      ]),
    ),
  );
  const chosen = posts.filter((p) => rows[p.postId]?.on);
  const run = useAction(async () => {
    const r = await igImportFn({
      data: {
        kind,
        categoryId: categoryId || null,
        items: chosen.map((p) => ({
          postId: p.postId,
          name: rows[p.postId]!.name,
          price: Number(rows[p.postId]!.price.replace(",", ".")) || 0,
          description: p.draft.description,
          keywords: p.draft.keywords,
        })),
      },
    });
    setDone(t("igImport.done", { n: r.created, m: r.withoutPhoto }));
    await router.invalidate();
  });
  const set = (id: string, patch: Partial<Row>) =>
    setRows((r) => ({ ...r, [id]: { ...r[id]!, ...patch } }));

  return (
    <>
      <Link to="/admin/products" className="text-sm text-muted hover:text-ink">
        ← {t("products.title")}
      </Link>
      <PageTitle title={t("igImport.title")} subtitle={t("igImport.subtitle")} />
      {done && <p className="mb-3 text-sm text-ok">{done}</p>}
      {!data.configured ? (
        <Empty>{t("igImport.notConfigured")}</Empty>
      ) : posts.length === 0 ? (
        <Empty>{t("igImport.empty")}</Empty>
      ) : (
        <Card>
          <p className="mb-3 text-sm text-muted">{t("igImport.hint")}</p>
          <div className="mb-4 flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2">
              {t("igImport.kind")}
              <HelpTip article="products" anchor="ig-import" />
              <select
                className="input w-auto"
                value={kind}
                onChange={(e) => setKind(e.target.value as "digital" | "physical")}
              >
                <option value="physical">{t("igImport.physical")}</option>
                <option value="digital">{t("igImport.digital")}</option>
              </select>
            </label>
            <label className="flex items-center gap-2">
              {t("igImport.category")}
              <select
                className="input w-auto"
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
              >
                <option value="">{t("igImport.noCategory")}</option>
                {data.categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="flex flex-col divide-y divide-line">
            {posts.map((p) => {
              const r = rows[p.postId]!;
              return (
                <div key={p.postId} className="flex gap-3 py-3">
                  <input
                    type="checkbox"
                    className="mt-2"
                    checked={r.on}
                    onChange={(e) => set(p.postId, { on: e.target.checked })}
                  />
                  {p.thumbnail ? (
                    <img
                      src={p.thumbnail}
                      alt=""
                      referrerPolicy="no-referrer"
                      className="h-20 w-20 shrink-0 rounded-md border border-line object-cover"
                    />
                  ) : (
                    <div className="h-20 w-20 shrink-0 rounded-md border border-line bg-surface-2" />
                  )}
                  <div className="min-w-0 flex-1 space-y-1">
                    <input
                      className="input"
                      aria-label={t("igImport.name")}
                      value={r.name}
                      maxLength={200}
                      onChange={(e) => set(p.postId, { name: e.target.value })}
                    />
                    <div className="flex items-center gap-2">
                      <input
                        className="input w-32"
                        inputMode="decimal"
                        aria-label={t("igImport.price")}
                        placeholder={t("igImport.price")}
                        value={r.price}
                        onChange={(e) => set(p.postId, { price: e.target.value })}
                      />
                      <span className="text-xs text-muted">
                        {p.draft.price === null ? t("igImport.noPrice") : (p.draft.currency ?? "")}
                      </span>
                      {p.permalink && (
                        <a
                          href={p.permalink}
                          target="_blank"
                          rel="noreferrer"
                          className="ml-auto text-xs text-accent hover:underline"
                        >
                          {t("igImport.open")}
                        </a>
                      )}
                    </div>
                    <p className="line-clamp-2 text-xs text-muted">{p.draft.description}</p>
                  </div>
                </div>
              );
            })}
          </div>
          <ErrorBox error={run.error} />
          <button
            className="btn-primary mt-3"
            disabled={run.busy || chosen.length === 0}
            onClick={() => void run.run().catch(() => {})}
          >
            {t("igImport.submit", { n: chosen.length })}
          </button>
        </Card>
      )}
    </>
  );
}
