import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { deleteProductFn, productFn, saveProductFn } from "@/app/admin/admin.functions";
import { Badge, Card, ErrorBox, Field, PageTitle, useAction } from "@/app/ui";
import { imagePath } from "@/core/catalog/image-url";
import { MATERIAL_LANGUAGES } from "@/core/catalog/materials";
import { localeNames, type Locale } from "@/core/i18n/locale";

export const Route = createFileRoute("/admin/_authed/products_/$id")({
  loader: ({ params }) => productFn({ data: { id: params.id === "new" ? null : params.id } }),
  component: ProductEditor,
});

type Img = { key: string };
type Mat = { language: Locale; filePath: string; fileName: string | null };
type Variant = { name: string; price: number };

async function upload(kind: "image" | "file", file: File): Promise<{ key: string; name: string }> {
  const fd = new FormData();
  fd.set("kind", kind);
  fd.set("file", file);
  const r = await fetch("/api/admin/upload", { method: "POST", body: fd });
  const j = (await r.json().catch(() => ({}))) as { key?: string; name?: string; error?: string };
  if (!r.ok || !j.key) throw new Error(j.error ?? `Загрузка не удалась (${r.status})`);
  return { key: j.key, name: j.name ?? file.name };
}

function ProductEditor() {
  const { product: p, categories, countries, defaultFulfillment } = Route.useLoaderData();
  const { shop } = Route.useRouteContext();
  const navigate = useNavigate();
  const isNew = !p;

  const [images, setImages] = useState<Img[]>(
    (p?.product_images ?? [])
      .slice()
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((i) => ({ key: i.image_path })),
  );
  const [materials, setMaterials] = useState<Mat[]>(
    (p?.product_material_files ?? [])
      .slice()
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
      .map((f) => ({
        language: (f.language as Locale) ?? "ru",
        filePath: f.file_path ?? "",
        fileName: f.file_name,
      })),
  );
  const [variants, setVariants] = useState<Variant[]>(
    (p?.product_variants ?? [])
      .slice()
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((v) => ({ name: v.name, price: Number(v.price) })),
  );
  const [kind, setKind] = useState<"digital" | "physical">(
    (p?.fulfillment_kind as "digital" | "physical") ?? defaultFulfillment,
  );
  const [uploading, setUploading] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<unknown>(null);

  const save = useAction(async (f: FormData) => {
    const countryPrices: Record<string, number> = {};
    for (const c of countries) {
      const v = Number(f.get(`cp_${c.code}`));
      if (v > 0) countryPrices[c.code] = v;
    }
    const num = (name: string) => {
      const v = f.get(name);
      return typeof v === "string" && v.trim() !== "" ? Number(v) : null;
    };
    const stock = num("stockQuantity");
    const lead = num("leadTimeDays");
    const { id } = await saveProductFn({
      data: {
        id: p?.id ?? null,
        product: {
          name: String(f.get("name")),
          description: String(f.get("description")),
          keywords: String(f.get("keywords")),
          price: Number(f.get("price")) || 0,
          currency: String(f.get("currency") || "KZT"),
          countryPrices,
          categoryIds: f.getAll("categoryIds").map(String),
          isActive: f.get("isActive") === "on",
          sortOrder: Number(f.get("sortOrder")) || 0,
          fulfillmentKind: kind,
          stockQuantity: stock,
          leadTimeDays: lead,
          images: images.map((i) => i.key),
          materials,
          variants: variants.filter((v) => v.name.trim()),
        },
      },
    });
    if (isNew) await navigate({ to: "/admin/products/$id", params: { id } });
    else await navigate({ to: "/admin/products" });
  });
  const del = useAction(async () => {
    if (!p || !confirm("Удалить товар вместе с файлами? Заказы с ним сохранятся.")) return;
    await deleteProductFn({ data: { id: p.id } });
    await navigate({ to: "/admin/products" });
  });

  const onUpload = async (kind: "image" | "file", files: FileList | null, lang?: Locale) => {
    if (!files?.length) return;
    setUploadError(null);
    for (const file of Array.from(files)) {
      setUploading(file.name);
      try {
        const r = await upload(kind, file);
        if (kind === "image") setImages((x) => [...x, { key: r.key }]);
        else
          setMaterials((x) => [
            ...x,
            { language: lang ?? "ru", filePath: r.key, fileName: r.name },
          ]);
      } catch (e) {
        setUploadError(e);
      } finally {
        setUploading(null);
      }
    }
  };
  const imgSrc = (key: string) => imagePath(shop.botId, key);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save.run(new FormData(e.currentTarget)).catch(() => {});
      }}
    >
      <PageTitle
        title={isNew ? "Новый товар" : p.name}
        subtitle={
          <Link to="/admin/products" className="hover:underline">
            ← к списку
          </Link>
        }
        actions={
          <>
            {!isNew && (
              <button
                type="button"
                className="btn-ghost text-danger"
                disabled={del.busy}
                onClick={() => void del.run().catch(() => {})}
              >
                Удалить
              </button>
            )}
            <button className="btn-primary" disabled={save.busy || Boolean(uploading)}>
              Сохранить
            </button>
          </>
        }
      />
      <ErrorBox error={save.error ?? del.error ?? uploadError} />
      <div className="mt-3 grid gap-4 lg:grid-cols-[1fr_340px]">
        <div className="space-y-4">
          <Card title="Описание">
            <div className="space-y-3">
              <Field label="Название">
                <input
                  className="input"
                  name="name"
                  defaultValue={p?.name ?? ""}
                  required
                  maxLength={200}
                />
              </Field>
              <Field label="Описание" hint="Показывается в карточке товара.">
                <textarea
                  className="input"
                  name="description"
                  rows={5}
                  defaultValue={p?.description ?? ""}
                />
              </Field>
              <Field
                label="Ключевые слова для поиска"
                hint="Через запятую: синонимы, класс, предмет."
              >
                <input className="input" name="keywords" defaultValue={p?.keywords ?? ""} />
              </Field>
              <Field label="Категории">
                <div className="grid gap-1 sm:grid-cols-2">
                  {categories.length === 0 && (
                    <span className="text-sm text-muted">
                      Категорий нет — товар покажется на первом экране.
                    </span>
                  )}
                  {categories.map((c) => (
                    <label key={c.id} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        name="categoryIds"
                        value={c.id}
                        defaultChecked={
                          Array.isArray(p?.category_ids) &&
                          (p!.category_ids as string[]).includes(c.id)
                        }
                      />
                      {c.name}
                    </label>
                  ))}
                </div>
              </Field>
            </div>
          </Card>

          <Card title="Цена">
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Базовая цена">
                <input
                  className="input"
                  name="price"
                  type="number"
                  min={0}
                  step="0.01"
                  defaultValue={p ? Number(p.price) : ""}
                  required
                />
              </Field>
              <Field label="Валюта">
                <input
                  className="input"
                  name="currency"
                  defaultValue={p?.currency ?? "KZT"}
                  maxLength={3}
                />
              </Field>
              <Field label="Порядок в списке">
                <input
                  className="input"
                  name="sortOrder"
                  type="number"
                  defaultValue={p?.sort_order ?? 0}
                />
              </Field>
            </div>
            {shop.modules.multi_currency && countries.length > 0 && (
              <div className="mt-4">
                <div className="label">Цена по странам (пусто — по курсу от базовой)</div>
                <div className="grid gap-2 sm:grid-cols-3">
                  {countries.map((c) => (
                    <Field key={c.code} label={`${c.name}, ${c.currency}`}>
                      <input
                        className="input"
                        name={`cp_${c.code}`}
                        type="number"
                        min={0}
                        step="0.01"
                        defaultValue={
                          (p?.country_prices as Record<string, number> | null)?.[c.code] ?? ""
                        }
                      />
                    </Field>
                  ))}
                </div>
              </div>
            )}
            <div className="mt-4">
              <div className="label">
                Варианты (например, «1 кг», «2 кг») — цена варианта вместо базовой
              </div>
              <div className="space-y-2">
                {variants.map((v, i) => (
                  <div key={i} className="flex gap-2">
                    <input
                      className="input"
                      placeholder="Название"
                      value={v.name}
                      onChange={(e) =>
                        setVariants((x) =>
                          x.map((y, j) => (j === i ? { ...y, name: e.target.value } : y)),
                        )
                      }
                    />
                    <input
                      className="input w-36"
                      type="number"
                      min={0}
                      step="0.01"
                      value={v.price}
                      onChange={(e) =>
                        setVariants((x) =>
                          x.map((y, j) => (j === i ? { ...y, price: Number(e.target.value) } : y)),
                        )
                      }
                    />
                    <button
                      type="button"
                      className="btn-ghost"
                      onClick={() => setVariants((x) => x.filter((_, j) => j !== i))}
                    >
                      ✕
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setVariants((x) => [...x, { name: "", price: 0 }])}
                >
                  + Вариант
                </button>
              </div>
            </div>
          </Card>

          <Card title="Тип и наличие">
            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="kind"
                  checked={kind === "digital"}
                  onChange={() => setKind("digital")}
                />{" "}
                Цифровой: файлы после оплаты
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="kind"
                  checked={kind === "physical"}
                  onChange={() => setKind("physical")}
                />{" "}
                Физический: доставка или самовывоз
              </label>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <Field label="Остаток" hint="Пусто — не учитывать.">
                <input
                  className="input"
                  name="stockQuantity"
                  type="number"
                  min={0}
                  defaultValue={p?.stock_quantity ?? ""}
                />
              </Field>
              {kind === "physical" && (
                <Field label="Срок изготовления, дней">
                  <input
                    className="input"
                    name="leadTimeDays"
                    type="number"
                    min={0}
                    defaultValue={p?.lead_time_days ?? ""}
                  />
                </Field>
              )}
              <label className="flex items-center gap-2 self-end pb-2 text-sm">
                <input type="checkbox" name="isActive" defaultChecked={p?.is_active ?? true} /> В
                продаже
              </label>
            </div>
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="Фото">
            <div className="grid grid-cols-3 gap-2">
              {images.map((img, i) => (
                <div key={img.key} className="group relative">
                  <img
                    src={imgSrc(img.key)}
                    alt=""
                    className="aspect-square w-full rounded object-cover"
                  />
                  <div className="absolute inset-x-0 bottom-0 flex justify-between bg-black/50 px-1 text-xs text-white opacity-0 group-hover:opacity-100">
                    <button
                      type="button"
                      onClick={() =>
                        i > 0 &&
                        setImages((x) => [
                          ...x.slice(0, i - 1),
                          x[i]!,
                          x[i - 1]!,
                          ...x.slice(i + 1),
                        ])
                      }
                    >
                      ←
                    </button>
                    <button
                      type="button"
                      onClick={() => setImages((x) => x.filter((_, j) => j !== i))}
                    >
                      ✕
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        i < images.length - 1 &&
                        setImages((x) => [...x.slice(0, i), x[i + 1]!, x[i]!, ...x.slice(i + 2)])
                      }
                    >
                      →
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <label className="btn-secondary mt-3 w-full cursor-pointer">
              {uploading ? `Загрузка: ${uploading}` : "+ Добавить фото"}
              <input
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => void onUpload("image", e.target.files)}
              />
            </label>
            <p className="mt-1 text-xs text-muted">Первое фото — обложка.</p>
          </Card>

          {kind === "digital" && (
            <Card
              title="Файлы материала"
              actions={
                materials.length === 0 ? (
                  <Badge tone="danger">нужен файл</Badge>
                ) : (
                  <Badge tone="ok">{materials.length}</Badge>
                )
              }
            >
              <ul className="space-y-2 text-sm">
                {materials.map((m, i) => (
                  <li key={m.filePath} className="flex items-center gap-2">
                    <select
                      className="input w-24"
                      value={m.language}
                      onChange={(e) =>
                        setMaterials((x) =>
                          x.map((y, j) =>
                            j === i ? { ...y, language: e.target.value as Locale } : y,
                          ),
                        )
                      }
                    >
                      {MATERIAL_LANGUAGES.map((l) => (
                        <option key={l} value={l}>
                          {l.toUpperCase()}
                        </option>
                      ))}
                    </select>
                    <span className="min-w-0 flex-1 truncate">
                      {m.fileName ?? m.filePath.split("/").pop()}
                    </span>
                    <button
                      type="button"
                      className="btn-ghost"
                      onClick={() => setMaterials((x) => x.filter((_, j) => j !== i))}
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
              <div className="mt-3 grid grid-cols-2 gap-2">
                {MATERIAL_LANGUAGES.filter(
                  (l) => l === "ru" || l === "kk" || shop.modules.multi_language,
                ).map((l) => (
                  <label key={l} className="btn-secondary cursor-pointer text-xs">
                    + {localeNames[l]}
                    <input
                      type="file"
                      multiple
                      className="hidden"
                      onChange={(e) => void onUpload("file", e.target.files, l)}
                    />
                  </label>
                ))}
              </div>
              <p className="mt-2 text-xs text-muted">
                PDF, ZIP, видео до 200 МБ. Покупатель получает все файлы своего языка.
              </p>
            </Card>
          )}
        </div>
      </div>
    </form>
  );
}
