import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import {
  catalogLayoutFn,
  categoriesFn,
  deleteCategoryFn,
  saveCatalogLayoutFn,
  saveCategoryFn,
  reorderFn,
} from "@/app/admin/admin.functions";
import { adminT } from "@/app/i18n/admin";
import {
  CATALOG_LAYOUTS,
  CATALOG_ORDER_MAX,
  type CatalogLayout,
} from "@/core/storefront/categories";
import { EmptyState } from "@/app/ui/states";
import { Card, ErrorBox, PageTitle, Switch, useAction } from "@/app/ui";

export const Route = createFileRoute("/admin/_authed/categories")({
  loader: async () => {
    const [cats, layout] = await Promise.all([categoriesFn(), catalogLayoutFn()]);
    return { cats, layout };
  },
  component: CategoriesPage,
});

type Cat = Awaited<ReturnType<typeof categoriesFn>>[number];
type T = ReturnType<typeof adminT>;

function tree(cats: Cat[]): Array<Cat & { depth: number }> {
  const byParent = new Map<string | null, Cat[]>();
  for (const c of cats) byParent.set(c.parent_id, [...(byParent.get(c.parent_id) ?? []), c]);
  const out: Array<Cat & { depth: number }> = [];
  const walk = (p: string | null, depth: number) => {
    for (const c of byParent.get(p) ?? []) {
      out.push({ ...c, depth });
      walk(c.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

function CategoriesPage() {
  const { cats, layout } = Route.useLoaderData();
  const { shop } = Route.useRouteContext();
  const t = adminT(shop.locale);
  const router = useRouter();
  const [editing, setEditing] = useState<Cat | null | "new">(null);
  const save = useAction(async (f: FormData, id: string | null) => {
    await saveCategoryFn({
      data: {
        id,
        name: String(f.get("name")),
        parentId: String(f.get("parentId")) || null,
        sortOrder: Number(f.get("sortOrder")) || 0,
        isVisible: f.get("isVisible") === "on",
      },
    });
    setEditing(null);
    await router.invalidate();
  });
  const del = useAction(async (id: string) => {
    if (!confirm(t("categories.deleteConfirm"))) return;
    await deleteCategoryFn({ data: { id } });
    await router.invalidate();
  });
  const vis = useAction(async (c: Cat, on: boolean) => {
    await saveCategoryFn({
      data: {
        id: c.id,
        name: c.name,
        parentId: c.parent_id,
        sortOrder: c.sort_order,
        isVisible: on,
      },
    });
    await router.invalidate();
  });
  const rows = tree(cats);
  // Перетаскивание — только среди соседей (один родитель): так дерево не ломается.
  const [drag, setDrag] = useState<string | null>(null);
  const reorder = useAction(async (fromId: string, toId: string) => {
    const from = cats.find((c) => c.id === fromId);
    const to = cats.find((c) => c.id === toId);
    if (!from || !to || from.id === to.id || from.parent_id !== to.parent_id) return;
    const siblings = rows.filter((c) => c.parent_id === from.parent_id).map((c) => c.id);
    const { moveItem } = await import("@/core/catalog/reorder");
    const ids = moveItem(siblings, siblings.indexOf(fromId), siblings.indexOf(toId));
    await reorderFn({ data: { table: "categories", ids, start: 10 } });
    await router.invalidate();
  });
  const current = editing === "new" ? null : editing;
  return (
    <>
      <PageTitle
        title={t("categories.title")}
        subtitle={t("categories.subtitle")}
        actions={
          <button className="btn-primary" onClick={() => setEditing("new")}>
            {t("categories.new")}
          </button>
        }
      />
      <ErrorBox error={del.error ?? vis.error ?? reorder.error} />
      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        {rows.length === 0 ? (
          <EmptyState
            title={t("categories.emptyTitle")}
            hint={t("categories.emptyHint")}
            action={{ label: t("categories.create"), onClick: () => setEditing("new") }}
          />
        ) : (
          <div className="card">
            <table className="table">
              <thead>
                <tr>
                  <th>{t("categories.col.name")}</th>
                  <th>{t("categories.col.order")}</th>
                  <th>{t("categories.col.visible")}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr
                    key={c.id}
                    draggable
                    onDragStart={() => setDrag(c.id)}
                    onDragOver={(e) => {
                      if (drag && cats.find((x) => x.id === drag)?.parent_id === c.parent_id)
                        e.preventDefault();
                    }}
                    onDrop={() => {
                      if (drag) void reorder.run(drag, c.id).catch(() => {});
                      setDrag(null);
                    }}
                    className={drag === c.id ? "opacity-50" : "cursor-grab"}
                  >
                    <td style={{ paddingLeft: 12 + c.depth * 20 }}>
                      <span className="mr-2 text-muted" aria-hidden>
                        ⠿
                      </span>
                      {c.name}
                    </td>
                    <td className="text-muted">{c.sort_order}</td>
                    <td>
                      <Switch
                        checked={c.is_visible}
                        onChange={(on) => void vis.run(c, on).catch(() => {})}
                        label={t("categories.col.visible")}
                      />
                    </td>
                    <td className="text-right whitespace-nowrap">
                      <button className="btn-ghost text-xs" onClick={() => setEditing(c)}>
                        {t("common.edit")}
                      </button>
                      <button
                        className="btn-ghost text-xs text-danger"
                        onClick={() => void del.run(c.id).catch(() => {})}
                      >
                        {t("common.delete")}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {editing !== null && (
          <Card title={current ? t("categories.edit") : t("categories.create")}>
            <form
              key={current?.id ?? "new"}
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                void save.run(new FormData(e.currentTarget), current?.id ?? null).catch(() => {});
              }}
            >
              <label className="block">
                <span className="label">{t("categories.col.name")}</span>
                <input
                  className="input"
                  name="name"
                  defaultValue={current?.name ?? ""}
                  required
                  maxLength={120}
                />
              </label>
              <label className="block">
                <span className="label">{t("categories.parent")}</span>
                <select className="input" name="parentId" defaultValue={current?.parent_id ?? ""}>
                  <option value="">{t("categories.root")}</option>
                  {rows
                    .filter((c) => c.id !== current?.id)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {" ".repeat(c.depth * 3)}
                        {c.name}
                      </option>
                    ))}
                </select>
              </label>
              <label className="block">
                <span className="label">{t("categories.col.order")}</span>
                <input
                  className="input"
                  name="sortOrder"
                  type="number"
                  defaultValue={current?.sort_order ?? 0}
                />
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name="isVisible"
                  defaultChecked={current?.is_visible ?? true}
                />{" "}
                {t("categories.showToCustomers")}
              </label>
              <ErrorBox error={save.error} />
              <div className="flex gap-2">
                <button className="btn-primary" disabled={save.busy}>
                  {t("common.save")}
                </button>
                <button type="button" className="btn-ghost" onClick={() => setEditing(null)}>
                  {t("common.cancel")}
                </button>
              </div>
            </form>
          </Card>
        )}
      </div>
      {rows.length > 0 && (
        <LayoutCard key={JSON.stringify(layout)} rows={rows} initial={layout} t={t} />
      )}
    </>
  );
}

/** Верхний ряд категорий витрины: дерево, одним рядом или свой список (как в v1). */
function LayoutCard({
  rows,
  initial,
  t,
}: {
  rows: Array<Cat & { depth: number }>;
  initial: CatalogLayout;
  t: T;
}) {
  const router = useRouter();
  const known = new Set(rows.map((c) => c.id));
  const [layout, setLayout] = useState(initial.layout);
  const [order, setOrder] = useState(initial.order.filter((id) => known.has(id)));
  const [saved, setSaved] = useState(false);
  const save = useAction(async () => {
    await saveCatalogLayoutFn({ data: { layout, order } });
    setSaved(true);
    await router.invalidate();
  });
  const name = (id: string) => rows.find((c) => c.id === id)?.name ?? id;
  const move = (i: number, d: -1 | 1) => {
    const next = [...order];
    [next[i], next[i + d]] = [next[i + d]!, next[i]!];
    setOrder(next);
    setSaved(false);
  };
  return (
    <div className="mt-4 max-w-xl">
      <Card title={t("categories.layout.title")}>
        <p className="mb-3 text-sm text-muted">{t("categories.layout.hint")}</p>
        <div className="space-y-1.5">
          {CATALOG_LAYOUTS.map((k) => (
            <label key={k} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="catalogLayout"
                checked={layout === k}
                onChange={() => {
                  setLayout(k);
                  setSaved(false);
                }}
              />
              {t(`categories.layout.${k}`)}
            </label>
          ))}
        </div>
        {layout === "custom" && (
          <div className="mt-3 space-y-2">
            {order.length === 0 ? (
              <p className="text-sm text-muted">{t("categories.layout.empty")}</p>
            ) : (
              <ol className="space-y-1 text-sm">
                {order.map((id, i) => (
                  <li key={id} className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate">
                      {i + 1}. {name(id)}
                    </span>
                    <button
                      type="button"
                      className="btn-ghost px-2 text-xs"
                      disabled={i === 0}
                      aria-label={t("categories.layout.up")}
                      onClick={() => move(i, -1)}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="btn-ghost px-2 text-xs"
                      disabled={i === order.length - 1}
                      aria-label={t("categories.layout.down")}
                      onClick={() => move(i, 1)}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      className="btn-ghost px-2 text-xs text-danger"
                      aria-label={t("categories.layout.remove")}
                      onClick={() => {
                        setOrder(order.filter((x) => x !== id));
                        setSaved(false);
                      }}
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ol>
            )}
            {order.length < CATALOG_ORDER_MAX && (
              <select
                className="input"
                value=""
                onChange={(e) => {
                  if (!e.target.value) return;
                  setOrder([...order, e.target.value]);
                  setSaved(false);
                }}
              >
                <option value="">{t("categories.layout.add")}</option>
                {rows
                  .filter((c) => !order.includes(c.id))
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {"\u00a0".repeat(c.depth * 3)}
                      {c.name}
                    </option>
                  ))}
              </select>
            )}
          </div>
        )}
        <ErrorBox error={save.error} />
        <div className="mt-3 flex items-center gap-3">
          <button
            className="btn-primary"
            disabled={save.busy}
            onClick={() => void save.run().catch(() => {})}
          >
            {t("common.save")}
          </button>
          {saved && <span className="text-sm text-muted">{t("categories.layout.saved")}</span>}
        </div>
      </Card>
    </div>
  );
}
