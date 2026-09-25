import { createFileRoute, Link, useNavigate, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { importCatalogFn, productsFn, setProductActiveFn } from "@/app/admin/admin.functions";
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
        title="Товары"
        subtitle={`${products.length} позиций`}
        actions={
          <div className="flex gap-2">
            <button className="btn-secondary" onClick={() => setImportOpen((v) => !v)}>
              Импорт / экспорт
            </button>
            <Link to="/admin/products/$id" params={{ id: "new" }} className="btn-primary">
              + Товар
            </Link>
          </div>
        }
      />
      {importOpen && <ImportCard onDone={() => router.invalidate()} />}
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

type Preview = NonNullable<Awaited<ReturnType<typeof importCatalogFn>>["preview"]>;
type Result = NonNullable<Awaited<ReturnType<typeof importCatalogFn>>["result"]>;

/**
 * Импорт из CSV (Excel → «Сохранить как CSV»): сначала предпросмотр — что
 * создастся, что обновится, какие колонки не поняты, — потом применение.
 * Выгрузка отдаёт тот же формат с id, чтобы правки в Excel возвращались.
 */
function ImportCard({ onDone }: { onDone: () => Promise<void> }) {
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
    if (!confirm(`Создать ${preview.create} и обновить ${preview.update} товаров?`)) return;
    const r = await importCatalogFn({ data: { csv, apply: true } });
    setResult(r.result);
    setPreview(null);
    await onDone();
  });
  return (
    <Card title="Импорт и экспорт каталога" className="mb-4">
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <p className="mb-2 text-sm text-muted">
            Выгрузите каталог в CSV, поправьте в Excel или Google Таблицах и загрузите обратно:
            строки с id обновятся, новые названия создадутся. Колонки: Название, Цена, Валюта,
            Категория, Описание, Ключевые слова, В продаже, Остаток, Тип, Ссылка, Ссылка kz.
          </p>
          <a className="btn-secondary inline-block" href="/api/admin/export/products">
            Скачать каталог (CSV)
          </a>
        </div>
        <div>
          <label className="btn-secondary inline-block cursor-pointer">
            {load.busy ? "Читаем…" : fileName ? `Файл: ${fileName}` : "Выбрать CSV для импорта"}
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
                Создать: <b>{preview.create}</b> · обновить: <b>{preview.update}</b>
                {preview.newCategories.length > 0 && (
                  <> · новые категории: {preview.newCategories.join(", ")}</>
                )}
              </p>
              {preview.unknownColumns.length > 0 && (
                <p className="text-xs text-muted">
                  Не поняты колонки (пропущены): {preview.unknownColumns.join(", ")}
                </p>
              )}
              {preview.errors.length > 0 && (
                <ul className="max-h-32 overflow-auto text-xs text-danger">
                  {preview.errors.map((e) => (
                    <li key={e.line}>
                      строка {e.line}: {e.message}
                    </li>
                  ))}
                </ul>
              )}
              {preview.samples.length > 0 && (
                <ul className="max-h-40 overflow-auto rounded-md border border-line p-2 text-xs">
                  {preview.samples.map((x, i) => (
                    <li key={i}>
                      <Badge tone={x.action === "create" ? "accent" : "neutral"}>
                        {x.action === "create" ? "новый" : "обновить"}
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
                {apply.busy ? "Загружаем…" : "Применить импорт"}
              </button>
            </div>
          )}
          {result && (
            <div className="mt-3 text-sm">
              <p>
                Готово: создано <b>{result.created}</b>, обновлено <b>{result.updated}</b>
                {result.categoriesCreated > 0 && `, новых категорий ${result.categoriesCreated}`}.
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
