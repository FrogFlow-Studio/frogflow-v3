import { canEdit } from "@/core/auth/roles";
import { createFileRoute, Link, useNavigate, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import {
  catalogSheetFn,
  disconnectCatalogSheetFn,
  importCatalogFn,
  previewCatalogSheetFn,
  productsFn,
  saveCatalogSheetFn,
  setProductActiveFn,
  reorderFn,
} from "@/app/admin/admin.functions";
import { adminT, type AdminT } from "@/app/i18n/admin";
import { Badge, Card, Empty, ErrorBox, PageTitle, Switch, useAction } from "@/app/ui";
import { formatMoney } from "@/core/money/money";
import { imagePath } from "@/core/catalog/image-url";
import { nextPageOffset } from "@/core/catalog/picker";

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
  const first = Route.useLoaderData();
  const { categories } = first;
  const { shop } = Route.useRouteContext();
  const t = adminT(shop.locale);
  const s = Route.useSearch();
  const navigate = useNavigate();
  const router = useRouter();
  const [q, setQ] = useState(s.q ?? "");
  const [importOpen, setImportOpen] = useState(false);
  // Первая страница — из загрузчика, следующие дописываются кнопкой «Показать ещё».
  const [products, setProducts] = useState(first.products);
  const [hasMore, setHasMore] = useState(first.hasMore);
  useEffect(() => {
    setProducts(first.products);
    setHasMore(first.hasMore);
  }, [first]);
  const more = useAction(async () => {
    const r = await productsFn({
      data: {
        q: s.q,
        categoryId: s.category ?? null,
        onlyInactive: s.inactive,
        offset: nextPageOffset(products.length),
      },
    });
    setProducts((p) => {
      const seen = new Set(p.map((x) => x.id));
      return [...p, ...r.products.filter((x) => !seen.has(x.id))];
    });
    setHasMore(r.hasMore);
  });
  // Переключатель правит строку на месте: перезагрузка сбросила бы дочитанные страницы.
  const toggle = useAction(async (id: string, on: boolean) => {
    await setProductActiveFn({ data: { id, active: on } });
    setProducts((p) => p.map((x) => (x.id === id ? { ...x, is_active: on } : x)));
  });
  const catName = new Map(categories.map((c) => [c.id, c.name]));
  // Порядок перетаскиванием — когда виден весь каталог без фильтров: иначе
  // перенумерованная часть перемешалась бы с невидимыми товарами.
  const canReorder = canEdit(shop.role) && !s.q && !s.category && !s.inactive && !hasMore;
  const [drag, setDrag] = useState<string | null>(null);
  const reorder = useAction(async (fromId: string, toId: string) => {
    const { moveItem } = await import("@/core/catalog/reorder");
    const ids = products.map((p) => p.id);
    const next = moveItem(ids, ids.indexOf(fromId), ids.indexOf(toId));
    setProducts((p) => next.map((id) => p.find((x) => x.id === id)!));
    await reorderFn({ data: { table: "products", ids: next, start: 10 } });
  });
  return (
    <>
      <PageTitle
        title={t("products.title")}
        subtitle={t("products.count", { n: first.total })}
        actions={
          <div className="flex gap-2">
            <button className="btn-secondary" onClick={() => setImportOpen((v) => !v)}>
              {t("products.importExport")}
            </button>
            {shop.modules.instagram && canEdit(shop.role) && (
              <Link to="/admin/ig-import" className="btn-secondary">
                {t("igImport.button")}
              </Link>
            )}
            <Link to="/admin/products/$id" params={{ id: "new" }} className="btn-primary">
              {t("products.new")}
            </Link>
          </div>
        }
      />
      {importOpen && (
        <>
          <SheetCard t={t} locale={shop.locale} onDone={() => router.invalidate()} />
          <ImportCard t={t} onDone={() => router.invalidate()} />
        </>
      )}
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
                <tr
                  key={p.id}
                  draggable={canReorder}
                  onDragStart={() => setDrag(p.id)}
                  onDragOver={(e) => {
                    if (canReorder && drag) e.preventDefault();
                  }}
                  onDrop={() => {
                    if (drag && drag !== p.id) void reorder.run(drag, p.id).catch(() => {});
                    setDrag(null);
                  }}
                  className={`hover:bg-surface-2/60 ${canReorder ? "cursor-grab" : ""} ${drag === p.id ? "opacity-50" : ""}`}
                >
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
                        <Badge tone="danger">{t("products.noFile")}</Badge>
                      )
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td>
                    <Switch
                      checked={p.is_active}
                      onChange={(on) => void toggle.run(p.id, on).catch(() => {})}
                      label={t("products.onSaleLabel")}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {(hasMore || products.length < first.total) && (
            <div className="flex flex-wrap items-center gap-3 border-t border-line p-3">
              <span className="text-sm text-muted">
                {t("products.shown", { n: products.length, total: first.total })}
              </span>
              {hasMore && (
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={more.busy}
                  onClick={() => void more.run().catch(() => {})}
                >
                  {t("products.showMore")}
                </button>
              )}
              <ErrorBox error={more.error ?? toggle.error ?? reorder.error} />
            </div>
          )}
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

type SheetInfo = Awaited<ReturnType<typeof catalogSheetFn>>;
type SheetRun = NonNullable<Awaited<ReturnType<typeof saveCatalogSheetFn>>>;

/**
 * Каталог из Google Таблицы: ссылка → предпросмотр → загрузка, дальше
 * обновление каждую ночь (core/catalog/sheet). Удалять таблица не умеет,
 * скрывает и перезаписывает ручные правки только по галочкам продавца.
 */
function SheetCard({
  t,
  locale,
  onDone,
}: {
  t: AdminT;
  locale: string;
  onDone: () => Promise<void>;
}) {
  const [info, setInfo] = useState<SheetInfo | null>(null);
  const [url, setUrl] = useState("");
  const [hideMissing, setHideMissing] = useState(false);
  const [overwriteManual, setOverwriteManual] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const reload = async () => {
    const r = await catalogSheetFn();
    setInfo(r);
    if (r.config) {
      setUrl(r.config.url);
      setHideMissing(r.config.hideMissing);
      setOverwriteManual(r.config.overwriteManual);
    }
  };
  useEffect(() => {
    void reload().catch(() => {});
  }, []);
  const reasonText = (r: string) => t(`sheet.reason.${r}` as Parameters<AdminT>[0]);
  const check = useAction(async () => {
    setPreview(null);
    const r = await previewCatalogSheetFn({ data: { url } });
    if (!r.ok) throw new Error(reasonText(r.reason));
    setPreview(r.preview);
  });
  const load = useAction(async () => {
    if (!preview) return;
    if (!confirm(t("sheet.confirm", { create: preview.create, update: preview.update }))) return;
    const r = await saveCatalogSheetFn({ data: { url, hideMissing, overwriteManual, run: true } });
    setPreview(null);
    await reload();
    await onDone();
    if (r && !r.ok) throw new Error(reasonText(r.reason));
  });
  const save = useAction(async () => {
    await saveCatalogSheetFn({ data: { url, hideMissing, overwriteManual, run: false } });
    await reload();
  });
  const disconnect = useAction(async () => {
    if (!confirm(t("sheet.disconnectConfirm"))) return;
    await disconnectCatalogSheetFn();
    setUrl("");
    setPreview(null);
    await reload();
  });
  const status = info?.status ?? null;
  const when = status ? new Date(status.at).toLocaleString(locale) : "";
  const connected = Boolean(info?.config);
  return (
    <Card title={t("sheet.title")} className="mb-4">
      <p className="mb-3 text-sm text-muted">{t("sheet.intro")}</p>
      <div className="flex flex-wrap gap-2">
        <input
          className="input min-w-0 flex-1"
          placeholder="https://docs.google.com/spreadsheets/d/…"
          aria-label={t("sheet.url")}
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            setPreview(null);
          }}
        />
        <button
          className="btn-secondary"
          disabled={!url.trim() || check.busy}
          onClick={() => void check.run().catch(() => {})}
        >
          {check.busy ? t("sheet.checking") : connected ? t("sheet.syncNow") : t("sheet.check")}
        </button>
      </div>
      <label className="mt-3 flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={hideMissing}
          onChange={(e) => setHideMissing(e.target.checked)}
        />
        {t("sheet.hideMissing")}
      </label>
      <label className="mt-1 flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={overwriteManual}
          onChange={(e) => setOverwriteManual(e.target.checked)}
        />
        {t("sheet.overwriteManual")}
      </label>
      <p className="mt-1 text-xs text-muted">{t("sheet.manualNote")}</p>
      <ErrorBox error={check.error ?? load.error ?? save.error ?? disconnect.error} />
      {preview && (
        <div className="mt-3 space-y-2 text-sm">
          <p>
            {t("products.import.create")} <b>{preview.create}</b> · {t("products.import.update")}{" "}
            <b>{preview.update}</b>
            {preview.newCategories.length > 0 && (
              <>
                {" "}
                · {t("products.import.newCategories")} {preview.newCategories.join(", ")}
              </>
            )}
          </p>
          {preview.errors.length > 0 && (
            <ul className="max-h-32 overflow-auto text-xs text-danger">
              {preview.errors.map((e) => (
                <li key={e.line}>
                  {t("products.import.line", { line: e.line, message: e.message })}
                </li>
              ))}
            </ul>
          )}
          <button
            className="btn-primary"
            disabled={!preview.ok || load.busy}
            onClick={() => void load.run().catch(() => {})}
          >
            {load.busy ? t("products.import.applying") : t("sheet.connect")}
          </button>
        </div>
      )}
      {connected && (
        <div className="mt-3 space-y-1 border-t border-line pt-3 text-sm">
          <p className="break-all text-xs text-muted">
            {t("sheet.connected")} {info!.config!.url}
          </p>
          {status && <SheetStatusLine t={t} status={status} when={when} reason={reasonText} />}
          <div className="flex gap-2 pt-1">
            <button
              className="btn-secondary text-sm"
              disabled={save.busy}
              onClick={() => void save.run().catch(() => {})}
            >
              {t("sheet.save")}
            </button>
            <button
              className="btn-ghost text-sm"
              disabled={disconnect.busy}
              onClick={() => void disconnect.run().catch(() => {})}
            >
              {t("sheet.disconnect")}
            </button>
          </div>
        </div>
      )}
    </Card>
  );
}

function SheetStatusLine({
  t,
  status,
  when,
  reason,
}: {
  t: AdminT;
  status: SheetRun & { at: string };
  when: string;
  reason: (r: string) => string;
}) {
  if (!status.ok)
    return (
      <p className="text-danger">{t("sheet.lastFail", { when, reason: reason(status.reason) })}</p>
    );
  return (
    <>
      <p>
        {t("sheet.lastOk", {
          when,
          created: status.created,
          updated: status.updated,
          hidden: status.hidden,
        })}
      </p>
      {status.kept > 0 && (
        <p className="text-xs text-muted">{t("sheet.kept", { n: status.kept })}</p>
      )}
      {status.needsReview > 0 && (
        <p className="text-xs text-muted">{t("sheet.needsReview", { n: status.needsReview })}</p>
      )}
      {status.skippedDeleted > 0 && (
        <p className="text-xs text-muted">
          {t("sheet.skippedDeleted", { n: status.skippedDeleted })}
        </p>
      )}
      {status.guard && <p className="text-xs text-danger">{t("sheet.guard")}</p>}
      {status.errors.length > 0 && (
        <ul className="max-h-24 overflow-auto text-xs text-danger">
          {status.errors.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      )}
    </>
  );
}
