import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { saveUpsellFn, upsellForProductFn } from "@/app/admin/upsell.functions";
import { deleteProductFn, productFn, saveProductFn } from "@/app/admin/admin.functions";
import { adminT, type AdminT } from "@/app/i18n/admin";
import { uploadFile } from "@/app/admin/upload-client";
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

async function upload(
  kind: "image" | "file",
  file: File,
  t: AdminT,
): Promise<{ key: string; name: string }> {
  const key = await uploadFile(kind, file, t, (status) => t("product.uploadFailed", { status }));
  return { key, name: file.name };
}

function ProductEditor() {
  const { product: p, waiting, categories, countries, defaultFulfillment } = Route.useLoaderData();
  const { shop } = Route.useRouteContext();
  const t = adminT(shop.locale);
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
          currency: String(f.get("currency") || shop.currency),
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
    if (!p || !confirm(t("product.deleteConfirm"))) return;
    await deleteProductFn({ data: { id: p.id } });
    await navigate({ to: "/admin/products" });
  });

  const onUpload = async (kind: "image" | "file", files: FileList | null, lang?: Locale) => {
    if (!files?.length) return;
    setUploadError(null);
    for (const file of Array.from(files)) {
      setUploading(file.name);
      try {
        const r = await upload(kind, file, t);
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
        title={isNew ? t("product.newTitle") : p.name}
        subtitle={
          <Link to="/admin/products" className="hover:underline">
            {t("product.backToList")}
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
                {t("common.delete")}
              </button>
            )}
            <button className="btn-primary" disabled={save.busy || Boolean(uploading)}>
              {t("common.save")}
            </button>
          </>
        }
      />
      <ErrorBox error={save.error ?? del.error ?? uploadError} />
      <div className="mt-3 grid gap-4 lg:grid-cols-[1fr_340px]">
        <div className="space-y-4">
          <Card title={t("product.card.description")}>
            <div className="space-y-3">
              <Field label={t("product.name")}>
                <input
                  className="input"
                  name="name"
                  defaultValue={p?.name ?? ""}
                  required
                  maxLength={200}
                />
              </Field>
              <Field label={t("product.description")} hint={t("product.descriptionHint")}>
                <textarea
                  className="input"
                  name="description"
                  rows={5}
                  defaultValue={p?.description ?? ""}
                />
              </Field>
              <Field label={t("product.keywords")} hint={t("product.keywordsHint")}>
                <input className="input" name="keywords" defaultValue={p?.keywords ?? ""} />
              </Field>
              <Field label={t("product.categories")}>
                <div className="grid gap-1 sm:grid-cols-2">
                  {categories.length === 0 && (
                    <span className="text-sm text-muted">{t("product.noCategories")}</span>
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

          <Card title={t("product.card.price")}>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label={t("product.basePrice")}>
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
              <Field label={t("product.currency")}>
                <input
                  className="input"
                  name="currency"
                  defaultValue={p?.currency ?? shop.currency}
                  maxLength={3}
                />
              </Field>
              <Field label={t("product.sortOrder")}>
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
                <div className="label">{t("product.countryPrices")}</div>
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
              <div className="label">{t("product.variants")}</div>
              <div className="space-y-2">
                {variants.map((v, i) => (
                  <div key={i} className="flex gap-2">
                    <input
                      className="input"
                      placeholder={t("product.variantName")}
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
                  {t("product.addVariant")}
                </button>
              </div>
            </div>
          </Card>

          <Card title={t("product.card.kind")}>
            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="kind"
                  checked={kind === "digital"}
                  onChange={() => setKind("digital")}
                />{" "}
                {t("product.kindDigital")}
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="kind"
                  checked={kind === "physical"}
                  onChange={() => setKind("physical")}
                />{" "}
                {t("product.kindPhysical")}
              </label>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <Field
                label={t("product.stock")}
                hint={
                  waiting > 0
                    ? `${t("product.stockHint")} ${t("product.waiting", { n: waiting })}`
                    : t("product.stockHint")
                }
              >
                <input
                  className="input"
                  name="stockQuantity"
                  type="number"
                  min={0}
                  defaultValue={p?.stock_quantity ?? ""}
                />
              </Field>
              {kind === "physical" && (
                <Field label={t("product.leadTime")}>
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
                <input type="checkbox" name="isActive" defaultChecked={p?.is_active ?? true} />{" "}
                {t("product.onSale")}
              </label>
            </div>
          </Card>
        </div>

        <div className="space-y-4">
          <Card title={t("product.card.photos")}>
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
              {uploading ? t("product.uploading", { name: uploading }) : t("product.addPhoto")}
              <input
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => void onUpload("image", e.target.files)}
              />
            </label>
            <p className="mt-1 text-xs text-muted">{t("product.firstIsCover")}</p>
          </Card>

          {kind === "digital" && (
            <Card
              title={t("product.card.files")}
              actions={
                materials.length === 0 ? (
                  <Badge tone="danger">{t("product.needFile")}</Badge>
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
              <p className="mt-2 text-xs text-muted">{t("product.filesHint")}</p>
            </Card>
          )}
          {shop.modules.upsell && p?.id && <UpsellCard productId={p.id} t={t} />}
        </div>
      </div>
    </form>
  );
}

/** «С этим предлагать»: до 10 товаров, которые бот покажет в корзине рядом с этим. */
function UpsellCard({ productId, t }: { productId: string; t: AdminT }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof upsellForProductFn>> | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    void upsellForProductFn({ data: { productId } }).then((r) => {
      setData(r);
      setPicked(r.selected);
    });
  }, [productId]);
  const save = useAction(async () => {
    await saveUpsellFn({ data: { productId, ids: picked } });
    setSaved(true);
  });
  if (!data) return null;
  const name = new Map(data.products.map((x) => [x.id, x.name]));
  return (
    <Card title={t("product.card.upsell")}>
      <p className="mb-2 text-xs text-muted">{t("product.upsellHint")}</p>
      <ul className="mb-2 space-y-1 text-sm">
        {picked.map((id) => (
          <li key={id} className="flex items-center justify-between gap-2">
            <span className="truncate">{name.get(id) ?? id}</span>
            <button
              type="button"
              className="btn-ghost text-xs"
              onClick={() => setPicked((x) => x.filter((y) => y !== id))}
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
      {picked.length < 10 && (
        <select
          className="input"
          value=""
          onChange={(e) => e.target.value && setPicked((x) => [...x, e.target.value])}
        >
          <option value="">{t("product.upsellAdd")}</option>
          {data.products
            .filter((x) => !picked.includes(x.id))
            .map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
        </select>
      )}
      <div className="mt-2 flex items-center gap-3">
        <button
          type="button"
          className="btn-secondary"
          disabled={save.busy}
          onClick={() => {
            setSaved(false);
            void save.run().catch(() => {});
          }}
        >
          {t("common.save")}
        </button>
        {saved && <span className="text-xs text-ok">✓</span>}
      </div>
      <ErrorBox error={save.error} />
    </Card>
  );
}
