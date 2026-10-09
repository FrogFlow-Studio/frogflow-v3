import { canEdit } from "@/core/auth/roles";
import { createFileRoute, Link, useNavigate, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import {
  bulkProductsFn,
  productIdsFn,
  productsFn,
  setProductActiveFn,
} from "@/app/admin/products.functions";
import { reorderFn } from "@/app/admin/catalog.functions";
import { adminT, intlLocale, type AdminKey } from "@/app/i18n/admin";
import { EmptyState } from "@/app/ui/states";
import { Badge, Empty, ErrorBox, PageTitle, Switch, useAction } from "@/app/ui";
import { ReadinessBadge } from "@/app/admin/product-readiness";
import { rowReadiness } from "@/core/catalog/readiness";
import { formatMoney } from "@/core/money/money";
import { imagePath } from "@/core/catalog/image-url";
import { nextPageOffset } from "@/core/catalog/picker";
import type { BulkAction } from "@/core/catalog/bulk";
import { runBulkInBatches, type BulkRun } from "@/core/catalog/bulk-batches";
import { STALE_OFFER_MAX } from "@/core/stock/stale-const";
import type { Locale } from "@/core/i18n/locale";
import { UpsellHealthCard } from "@/app/admin/product-list/upsell-health";
import { ShopKindCard } from "@/app/admin/product-list/shop-kind";
import { SheetCard } from "@/app/admin/product-list/sheet-card";
import { ImportCard } from "@/app/admin/product-list/import-card";
import { BulkBar } from "@/app/admin/product-list/bulk-bar";

const SORTS = ["catalog", "new", "old", "name", "price"] as const;

type Sort = (typeof SORTS)[number];

const SORT_KEY = "ff-admin-products-sort";

const LANG_LABEL: Record<Locale, string> = { ru: "RU", kk: "KZ", en: "EN", uz: "UZ" };

/** `?lang=kk` — есть на казахском, `?lang=-kk` — нет на казахском. */
function langFilter(v: string | undefined): { lang: Locale; has: boolean } | null {
  const m = /^(-?)(ru|kk|en|uz)$/.exec(v ?? "");
  return m ? { lang: m[2] as Locale, has: !m[1] } : null;
}

/** Фильтр и порядок списка — одни для первой страницы, «Показать ещё» и «Выбрать все». */
function listQuery(s: {
  q?: string;
  category?: string;
  inactive?: boolean;
  sort?: Sort;
  lang?: string;
  notopic?: boolean;
}) {
  return {
    q: s.q,
    categoryId: s.category ?? null,
    onlyInactive: s.inactive,
    sort: s.sort,
    lang: langFilter(s.lang),
    noTopic: s.notopic,
  };
}

export const Route = createFileRoute("/admin/_authed/products")({
  validateSearch: z.object({
    q: z.string().optional(),
    category: z.string().optional(),
    inactive: z.boolean().optional(),
    sort: z.enum(SORTS).optional(),
    lang: z.string().optional(),
    notopic: z.boolean().optional(),
  }),
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => productsFn({ data: listQuery(deps) }),
  component: ProductsPage,
});

function ProductsPage() {
  const first = Route.useLoaderData();
  const { categories } = first;
  const { shop } = Route.useRouteContext();
  const school = shop.vertical === "courses";
  const t = adminT(shop.locale);
  const s = Route.useSearch();
  const navigate = useNavigate();
  const router = useRouter();
  const [q, setQ] = useState(s.q ?? "");
  const lf = langFilter(s.lang);
  const langs = (["ru", "kk", "en", "uz"] as const).filter(
    (l) => l === "ru" || l === "kk" || shop.modules.multi_language,
  );
  const sort: Sort = s.sort ?? "catalog";
  // Выбранный порядок запоминается в браузере: завтра «Товары» откроются так же.
  useEffect(() => {
    if (s.sort) return;
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(SORT_KEY);
    } catch {
      /* без localStorage — порядок каталога */
    }
    if (saved && saved !== "catalog" && (SORTS as readonly string[]).includes(saved))
      void navigate({
        to: "/admin/products",
        search: (p) => ({ ...(p as typeof s), sort: saved as Sort }),
        replace: true,
      });
    // Только при входе на страницу.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const setSort = (v: Sort) => {
    try {
      localStorage.setItem(SORT_KEY, v);
    } catch {
      /* без localStorage — только в адресе */
    }
    void navigate({
      to: "/admin/products",
      search: (p) => ({ ...(p as typeof s), sort: v === "catalog" ? undefined : v }),
    });
  };
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
      data: { ...listQuery(s), offset: nextPageOffset(products.length) },
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
  // Выбор для массовых действий: по id, переживает «Показать ещё».
  const editable = canEdit(shop.role);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [bulkResult, setBulkResult] = useState<(BulkRun & { total: number }) | null>(null);
  const bulk = useAction(async (action: BulkAction) => {
    if (!confirm(t("products.bulk.confirm", { n: picked.size }))) return;
    const ids = [...picked];
    // По 500 за вызов: «все по фильтру» может быть больше лимита одного вызова.
    const r = await runBulkInBatches(ids, (batch) =>
      bulkProductsFn({ data: { ids: batch, action } }),
    );
    // Первая же пачка упала — ничего не тронуто: показываем саму ошибку.
    if (r.error && r.processed === 0) throw r.error;
    setBulkResult({ ...r, total: ids.length });
    setPicked(new Set());
    await router.invalidate();
  });
  // «Выбрать все N по фильтру»: id всех товаров под текущим фильтром, не только дочитанных страниц.
  const pickAll = useAction(async () => {
    const r = await productIdsFn({ data: listQuery(s) });
    setPicked(new Set(r.ids));
  });
  const togglePick = (id: string, on: boolean) =>
    setPicked((p) => {
      const n = new Set(p);
      if (on) n.add(id);
      else n.delete(id);
      return n;
    });
  // Порядок перетаскиванием — когда виден весь каталог без фильтров: иначе
  // перенумерованная часть перемешалась бы с невидимыми товарами.
  const filtered = Boolean(s.q || s.category || s.inactive || s.notopic || lf);
  const canReorder = canEdit(shop.role) && !filtered && sort === "catalog" && !hasMore;
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
        title={t(school ? "products.titleCourses" : "products.title")}
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
              {t(school ? "products.newCourse" : "products.new")}
            </Link>
          </div>
        }
      />
      {shop.modules.upsell && <UpsellHealthCard t={t} editable={editable} />}
      {first.kindTemplate && editable && <ShopKindCard t={t} onDone={() => router.invalidate()} />}
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
          void navigate({
            to: "/admin/products",
            search: (p) => ({ ...(p as typeof s), q: q || undefined }),
          });
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
              search: (p) => ({ ...(p as typeof s), category: e.target.value || undefined }),
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
                search: (p) => ({ ...(p as typeof s), inactive: e.target.checked || undefined }),
              })
            }
          />{" "}
          {t("products.onlyHidden")}
        </label>
        <select
          className="input w-48"
          aria-label={t("products.sort.label")}
          value={sort}
          onChange={(e) => setSort(e.target.value as Sort)}
        >
          {SORTS.map((v) => (
            <option key={v} value={v}>
              {t(`products.sort.${v}`)}
            </option>
          ))}
        </select>
        <select
          className="input w-48"
          aria-label={t("products.lang.label")}
          title={t("products.lang.missingHint")}
          value={s.lang && lf ? s.lang : ""}
          onChange={(e) =>
            void navigate({
              to: "/admin/products",
              search: (p) => ({ ...(p as typeof s), lang: e.target.value || undefined }),
            })
          }
        >
          <option value="">{t("products.lang.all")}</option>
          {langs.flatMap((l) => [
            <option key={l} value={l}>
              {t("products.lang.has", { lang: LANG_LABEL[l] })}
            </option>,
            <option key={`-${l}`} value={`-${l}`}>
              {t("products.lang.missing", { lang: LANG_LABEL[l] })}
            </option>,
          ])}
        </select>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={Boolean(s.notopic)}
            onChange={(e) =>
              void navigate({
                to: "/admin/products",
                search: { ...s, notopic: e.target.checked || undefined },
              })
            }
          />{" "}
          {t("products.noTopic")}
        </label>
        <button className="btn-secondary">{t("common.search")}</button>
      </form>
      {canEdit(shop.role) && !canReorder && !hasMore && products.length > 1 && (
        <p className="-mt-2 mb-3 text-xs text-muted">{t("products.reorderHint")}</p>
      )}
      {(bulkResult || bulk.error) && (
        <div className="mb-3 text-sm">
          <ErrorBox error={bulk.error} />
          {bulkResult && (
            <>
              <p>
                {t("products.bulk.result", {
                  changed: bulkResult.changed,
                  skipped: bulkResult.skipped.length,
                })}
              </p>
              {bulkResult.error != null && (
                <p className="text-danger">
                  {t("products.bulk.partial", {
                    done: bulkResult.processed,
                    total: bulkResult.total,
                  })}
                </p>
              )}
              {bulkResult.stock.length > 0 && (
                <ul className="mt-1 max-h-32 overflow-auto text-xs text-muted">
                  {bulkResult.stock.map((x) => (
                    <li key={x.id}>
                      {t("products.bulk.stockReport", {
                        name: x.name,
                        from: x.from ?? t("products.bulk.stockNone"),
                        to: x.to,
                      })}
                    </li>
                  ))}
                </ul>
              )}
              {bulkResult.skipped.length > 0 && (
                <ul className="mt-1 max-h-32 overflow-auto text-xs text-muted">
                  {bulkResult.skipped.slice(0, 50).map((x) => (
                    <li key={x.id}>
                      {x.name || x.id}: {t(`products.bulk.reason.${x.reason}` as AdminKey)}
                    </li>
                  ))}
                  {bulkResult.skipped.length > 50 && (
                    <li>{t("products.bulk.moreSkipped", { n: bulkResult.skipped.length - 50 })}</li>
                  )}
                </ul>
              )}
            </>
          )}
        </div>
      )}
      {products.length === 0 ? (
        filtered ? (
          <Empty>{t(school ? "products.emptyCourses" : "products.empty")}</Empty>
        ) : (
          <EmptyState
            title={t(school ? "products.emptyCourses" : "products.empty")}
            hint={t("products.emptyHint")}
            action={{
              label: t(school ? "products.addFirstCourse" : "products.addFirst"),
              to: "/admin/products/$id",
              params: { id: "new" },
            }}
          />
        )
      ) : (
        <div className="card overflow-x-auto">
          {editable && picked.size > 0 && (
            <BulkBar
              t={t}
              n={picked.size}
              total={first.total}
              picking={pickAll.busy}
              onPickAll={() => void pickAll.run().catch(() => {})}
              onOffer={() =>
                void navigate({
                  to: "/admin/discounts",
                  search: { offerProducts: [...picked].slice(0, STALE_OFFER_MAX).join(",") },
                })
              }
              categories={categories}
              topics={first.topics}
              stockOn={Boolean(shop.modules.stock)}
              busy={bulk.busy}
              onClear={() => setPicked(new Set())}
              onRun={(a) => void bulk.run(a).catch(() => {})}
            />
          )}
          <table className="table">
            <thead>
              <tr>
                {editable && (
                  <th className="w-8">
                    <input
                      type="checkbox"
                      aria-label={t("products.bulk.selectAll")}
                      checked={products.length > 0 && products.every((p) => picked.has(p.id))}
                      onChange={(e) =>
                        setPicked(e.target.checked ? new Set(products.map((p) => p.id)) : new Set())
                      }
                    />
                  </th>
                )}
                <th></th>
                <th>{t("products.col.name")}</th>
                <th>{t("products.col.categories")}</th>
                <th className="text-right">{t("products.col.price")}</th>
                <th className="text-right">{t("products.col.stock")}</th>
                <th>{t("products.col.ready")}</th>
                {shop.modules.stock && <th className="text-right">{t("products.col.daysLeft")}</th>}
                <th>{t("products.col.files")}</th>
                <th>{t("products.col.added")}</th>
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
                  {editable && (
                    <td className="w-8">
                      <input
                        type="checkbox"
                        aria-label={t("products.bulk.rowSelect", { name: p.name })}
                        checked={picked.has(p.id)}
                        onChange={(e) => togglePick(p.id, e.target.checked)}
                      />
                    </td>
                  )}
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
                  <td className="text-right tabular-nums">
                    {p.stock_quantity === null ? "—" : p.stock_quantity}
                  </td>
                  <td>
                    <ReadinessBadge r={rowReadiness(p)} t={t} />
                  </td>
                  {shop.modules.stock && (
                    <td
                      className={`text-right tabular-nums ${
                        p.days_left !== null && p.days_left < 7 ? "font-medium text-danger" : ""
                      }`}
                      title={t("products.daysLeftHint")}
                    >
                      {p.days_left === null ? "—" : t("products.daysLeft", { n: p.days_left })}
                    </td>
                  )}
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
                    {p.langs.length > 0 && (
                      <div className="mt-1 text-xs text-muted" aria-label={t("products.col.langs")}>
                        {p.langs.map((l) => LANG_LABEL[l]).join(" ")}
                      </div>
                    )}
                  </td>
                  <td className="whitespace-nowrap text-muted tabular-nums">
                    {new Date(p.created_at).toLocaleDateString(intlLocale(shop.locale), {
                      timeZone: "UTC",
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
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
