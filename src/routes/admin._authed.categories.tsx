import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { categoriesFn, deleteCategoryFn, saveCategoryFn } from "@/app/admin/admin.functions";
import { Card, Empty, ErrorBox, PageTitle, Switch, useAction } from "@/app/ui";

export const Route = createFileRoute("/admin/_authed/categories")({
  loader: () => categoriesFn(),
  component: CategoriesPage,
});

type Cat = Awaited<ReturnType<typeof categoriesFn>>[number];

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
  const cats = Route.useLoaderData();
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
    if (!confirm("Удалить категорию?")) return;
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
  const current = editing === "new" ? null : editing;
  return (
    <>
      <PageTitle
        title="Категории"
        subtitle="Дерево каталога в боте и на витрине"
        actions={
          <button className="btn-primary" onClick={() => setEditing("new")}>
            + Категория
          </button>
        }
      />
      <ErrorBox error={del.error ?? vis.error} />
      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        {rows.length === 0 ? (
          <Empty>
            Категорий пока нет. Товары без категории показываются на первом экране каталога.
          </Empty>
        ) : (
          <div className="card">
            <table className="table">
              <thead>
                <tr>
                  <th>Название</th>
                  <th>Порядок</th>
                  <th>Видна</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id}>
                    <td style={{ paddingLeft: 12 + c.depth * 20 }}>{c.name}</td>
                    <td className="text-muted">{c.sort_order}</td>
                    <td>
                      <Switch
                        checked={c.is_visible}
                        onChange={(on) => void vis.run(c, on).catch(() => {})}
                        label="видимость"
                      />
                    </td>
                    <td className="text-right whitespace-nowrap">
                      <button className="btn-ghost text-xs" onClick={() => setEditing(c)}>
                        Изменить
                      </button>
                      <button
                        className="btn-ghost text-xs text-danger"
                        onClick={() => void del.run(c.id).catch(() => {})}
                      >
                        Удалить
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {editing !== null && (
          <Card title={current ? "Изменить категорию" : "Новая категория"}>
            <form
              key={current?.id ?? "new"}
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                void save.run(new FormData(e.currentTarget), current?.id ?? null).catch(() => {});
              }}
            >
              <label className="block">
                <span className="label">Название</span>
                <input
                  className="input"
                  name="name"
                  defaultValue={current?.name ?? ""}
                  required
                  maxLength={120}
                />
              </label>
              <label className="block">
                <span className="label">Родительская категория</span>
                <select className="input" name="parentId" defaultValue={current?.parent_id ?? ""}>
                  <option value="">— корень каталога —</option>
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
                <span className="label">Порядок</span>
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
                Показывать покупателям
              </label>
              <ErrorBox error={save.error} />
              <div className="flex gap-2">
                <button className="btn-primary" disabled={save.busy}>
                  Сохранить
                </button>
                <button type="button" className="btn-ghost" onClick={() => setEditing(null)}>
                  Отмена
                </button>
              </div>
            </form>
          </Card>
        )}
      </div>
    </>
  );
}
