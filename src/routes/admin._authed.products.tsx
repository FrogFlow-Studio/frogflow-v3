import { createFileRoute, Link, useNavigate, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { productsFn, setProductActiveFn } from "@/app/admin/admin.functions";
import { Badge, Empty, PageTitle, Switch, useAction } from "@/app/ui";
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
  const s = Route.useSearch();
  const navigate = useNavigate();
  const router = useRouter();
  const [q, setQ] = useState(s.q ?? "");
  const toggle = useAction(async (id: string, on: boolean) => {
    await setProductActiveFn({ data: { id, active: on } });
    await router.invalidate();
  });
  const catName = new Map(categories.map((c) => [c.id, c.name]));
  return (
    <>
      <PageTitle
        title="Товары"
        subtitle={`${products.length} позиций`}
        actions={
          <Link to="/admin/products/$id" params={{ id: "new" }} className="btn-primary">
            + Товар
          </Link>
        }
      />
      <form
        className="mb-4 flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void navigate({ to: "/admin/products", search: { ...s, q: q || undefined } });
        }}
      >
        <input
          className="input w-56"
          placeholder="Поиск по названию"
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
          <option value="">Все категории</option>
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
          только скрытые
        </label>
        <button className="btn-secondary">Найти</button>
      </form>
      {products.length === 0 ? (
        <Empty>
          Товаров нет.{" "}
          <Link
            to="/admin/products/$id"
            params={{ id: "new" }}
            className="text-accent hover:underline"
          >
            Добавить первый
          </Link>
        </Empty>
      ) : (
        <div className="card overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th></th>
                <th>Название</th>
                <th>Категории</th>
                <th className="text-right">Цена</th>
                <th>Файлы</th>
                <th>В продаже</th>
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
                      {p.fulfillment_kind === "physical" ? "физический" : "цифровой"}
                      {p.variants ? ` · ${p.variants} вар.` : ""}
                      {p.stock_quantity != null ? ` · остаток ${p.stock_quantity}` : ""}
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
