import { createFileRoute, Link, useNavigate, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { importCatalogFn, productsFn, setProductActiveFn } from "@/app/admin/admin.functions";
import { adminT, type AdminT } from "@/app/i18n/admin";
import { Badge, Card, Empty, ErrorBox, PageTitle, Switch, useAction } from "@/app/ui";
import { formatMoney } from "@/core/money/money";
import { imagePath } from "@/core/catalog/image-url";

export const Route = createFileRoute("/admin/_authed/products")({
  validateSearch: z.object({
    q: z.string().optional(),
    category: z.string().optional(),
    inactive: z.boolean().optional(),
  }),
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) =>
    productsFn({
      data: { q: deps.q, categoryId: deps.category ?? null, onlyInactive: deps.inactive },
    }),
  component: ProductsPage,
});

function ProductsPage() {
  const { products, categories } = Route.useLoaderData();
  const { shop } = Route.useRouteContext();
  const t = adminT(shop.locale);
  const s = Route.useSearch();
  const navigate = useNavigate();
  const router = useRouter();
  const [q, setQ] = useState(s.q ?? "");
  const [importOpen, setImportOpen] = useState(false);
  const toggle = useAction(async (id: string, on: boolean) => {
    await setProductActiveFn({ data: { id, active: on } });
    await router.invalidate();
  });
  const catName = new Map(categories.map((c) => [c.id, c.name]));
  return (
    <>
      <PageTitle
        title={t("products.title")}
        subtitle={t("products.count", { n: products.length })}
        actions={
          <div className="flex gap-2">
            <button className="btn-secondary" onClick={() => setImportOpen((v) => !v)}>
              {t("products.importExport")}
            </button>
            <Link to="/admin/products/$id" params={{ id: "new" }} className="btn-primary">
              {t("products.new")}
            </Link>
          </div>
        }
      />
      {importOpen && <ImportCard t={t} onDone={() => router.invalidate()} />}
      <form
        className="mb-4 flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void navigate({ to: "/admin/products", search: { ...s, q: q || undefined } });
        }}
      >
        <input
          className="input w-56"
          placeholder={t("products.searchPlaceholder")}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select
          className="input w-56"
          value={s.category ?? ""}
          onChange={(e) =>
            void navigate({
              to: "/admin/products",
              search: { ...s, category: e.target.value || undefined },
            })
          }
        >
          <option value="">{t("products.allCategories")}</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={Boolean(s.inactive)}
            onChange={(e) =>
              void navigate({
                to: "/admin/products",
                search: { ...s, inactive: e.target.checked || undefined },
              })
            }
          />{" "}
          {t("products.onlyHidden")}
        </label>
        <button className="btn-secondary">{t("common.search")}</button>
      </form>
      {products.length === 0 ? (
        <Empty>
          {t("products.empty")}{" "}
          <Link
            to="/admin/products/$id"
            params={{ id: "new" }}
            className="text-accent hover:underline"
          >
            {t("products.addFirst")}
          </Link>
        </Empty>
      ) : (
        <div className="card overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th></th>
                <th>{t("products.col.name")}</th>
                <th>{t("products.col.categories")}</th>
                <th className="text-right">{t("products.col.price")}</th>
                <th>{t("products.col.files")}</th>
                <th>{t("products.col.onSale")}</th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.id} className="hover:bg-surface-2/60">
                  <td className="w-12">
                    {p.cover ? (
                      <img
                        src={imagePath(shop.botId, p.cover)}
                        alt=""
                        className="h-10 w-10 rounded object-cover"
                      />
                    ) : (
                      <div className="h-10 w-10 rounded bg-surface-2" />
                    )}
                  </td>
                  <td>
                    <Link
                      to="/admin/products/$id"
                      params={{ id: p.id }}
                      className="font-medium hover:underline"
                    >
                      {p.name}
                    </Link>
                    <div className="text-xs text-muted">
                      {p.fulfillment_kind === "physical" ? t("order.physical") : t("order.digital")}
                      {p.variants ? ` · ${t("products.variants", { n: p.variants })}` : ""}
                      {p.stock_quantity != null
                        ? ` · ${t("products.stock", { n: p.stock_quantity })}`
                        : ""}
                    </div>
                  </td>
                  <td className="text-muted">
                    {(Array.isArray(p.category_ids) ? (p.category_ids as string[]) : [])
                      .map((id) => catName.get(id) ?? "?")
                      .join(", ") || "—"}
                  </td>
                  <td className="text-right tabular-nums">{formatMoney(p.price, p.currency)}</td>
                  <td>
                    {p.fulfillment_kind === "digital" ? (
                      p.files ? (
                        <Badge tone="ok">{p.files}</Badge>
                      ) : (
                        <Badge tone="danger">нет файла</Badge>
                      )
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td>
                    <Switch
                      checked={p.is_active}
                      onChange={(on) => void toggle.run(p.id, on).catch(() => {})}
                      label="в продаже"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

type Preview = NonNullable<Awaited<ReturnType<typeof importCatalogFn>>["preview"]>;
type Result = NonNullable<Awaited<ReturnType<typeof importCatalogFn>>["result"]>;

/**
 * Импорт из CSV (Excel → «Сохранить как CSV»): сначала предпросмотр — что
 * создастся, что обновится, какие колонки не поняты, — потом применение.
 * Выгрузка отдаёт тот же формат с id, чтобы правки в Excel возвращались.
 */
function ImportCard({ t, onDone }: { t: AdminT; onDone: () => Promise<void> }) {
  const [csv, setCsv] = useState("");
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const load = useAction(async (file: File) => {
    const text = await file.text();
    setFileName(file.name);
    setCsv(text);
    setResult(null);
    const r = await importCatalogFn({ data: { csv: text, apply: false } });
    setPreview(r.preview);
  });
  const apply = useAction(async () => {
    if (!preview) return;
    if (!confirm(t("products.import.confirm", { create: preview.create, update: preview.update })))
      return;
    const r = await importCatalogFn({ data: { csv, apply: true } });
    setResult(r.result);
    setPreview(null);
    await onDone();
  });
  return (
    <Card title={t("products.import.title")} className="mb-4">
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <p className="mb-2 text-sm text-muted">{t("products.import.intro")}</p>
          <a className="btn-secondary inline-block" href="/api/admin/export/products">
            {t("products.import.download")}
          </a>
        </div>
        <div>
          <label className="btn-secondary inline-block cursor-pointer">
            {load.busy
              ? t("products.import.reading")
              : fileName
                ? t("products.import.file", { name: fileName })
                : t("products.import.choose")}
            <input
              type="file"
              accept=".csv,text/csv,text/plain"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void load.run(f).catch(() => {});
                e.target.value = "";
              }}
            />
          </label>
          <ErrorBox error={load.error ?? apply.error} />
          {preview && (
            <div className="mt-3 space-y-2 text-sm">
              <p>
                {t("products.import.create")} <b>{preview.create}</b> ·{" "}
                {t("products.import.update")} <b>{preview.update}</b>
                {preview.newCategories.length > 0 && (
                  <>
                    {" "}
                    · {t("products.import.newCategories")} {preview.newCategories.join(", ")}
                  </>
                )}
              </p>
              {preview.unknownColumns.length > 0 && (
                <p className="text-xs text-muted">
                  {t("products.import.unknown", { cols: preview.unknownColumns.join(", ") })}
                </p>
              )}
              {preview.errors.length > 0 && (
                <ul className="max-h-32 overflow-auto text-xs text-danger">
                  {preview.errors.map((e) => (
                    <li key={e.line}>
                      {t("products.import.line", { line: e.line, message: e.message })}
                    </li>
                  ))}
                </ul>
              )}
              {preview.samples.length > 0 && (
                <ul className="max-h-40 overflow-auto rounded-md border border-line p-2 text-xs">
                  {preview.samples.map((x, i) => (
                    <li key={i}>
                      <Badge tone={x.action === "create" ? "accent" : "neutral"}>
                        {x.action === "create"
                          ? t("products.import.rowNew")
                          : t("products.import.rowUpdate")}
                      </Badge>{" "}
                      {x.name}
                      {x.price !== null && ` — ${x.price}`}
                      {x.category && <span className="text-muted"> · {x.category}</span>}
                    </li>
                  ))}
                </ul>
              )}
              <button
                className="btn-primary"
                disabled={!preview.ok || apply.busy}
                onClick={() => void apply.run().catch(() => {})}
              >
                {apply.busy ? t("products.import.applying") : t("products.import.apply")}
              </button>
            </div>
          )}
          {result && (
            <div className="mt-3 text-sm">
              <p>
                {t("products.import.done", { created: result.created, updated: result.updated })}
                {result.categoriesCreated > 0 &&
                  t("products.import.doneCategories", { n: result.categoriesCreated })}
                .
              </p>
              {result.errors.length > 0 && (
                <ul className="mt-1 max-h-32 overflow-auto text-xs text-danger">
                  {result.errors.map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
