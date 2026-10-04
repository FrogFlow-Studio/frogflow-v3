import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ProductSearch } from "@/app/admin/product-picker";
import { useEffect, useState } from "react";
import { BundleCard } from "@/app/admin/bundle-card";
import { saveUpsellFn, upsellForProductFn } from "@/app/admin/upsell.functions";
import {
  copyProductFn,
  deleteProductFn,
  productFn,
  productPreviewFn,
  productSubscriptionFn,
  saveProductFn,
  saveProductPreviewFn,
  saveProductSubscriptionFn,
  stockHistoryFn,
} from "@/app/admin/admin.functions";
import { adminT, intlLocale, type AdminT } from "@/app/i18n/admin";
import { uploadFile } from "@/app/admin/upload-client";
import { CourseCard } from "@/app/admin/course-card";
import { CostEditor } from "@/app/admin/cost-editor";
import { productCostFn } from "@/app/admin/cost.functions";
import { canEdit } from "@/core/auth/roles";
import type { ProductCost } from "@/core/profit/cost";
import { assistDescriptionFn } from "@/app/admin/assistant.functions";
import { Badge, Card, ErrorBox, Field, PageTitle, useAction } from "@/app/ui";
import { imagePath } from "@/core/catalog/image-url";
import { editableMaterials, MATERIAL_LANGUAGES } from "@/core/catalog/materials";
import { isCourseProduct } from "@/core/courses/marker";
import { categoryPaths, type CategoryOption } from "@/app/admin/category-paths";
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
  onProgress?: (sent: number, total: number) => void,
): Promise<{ key: string; name: string }> {
  const key = await uploadFile(
    kind,
    file,
    t,
    (status) => (status === 0 ? t("product.uploadBroken") : t("product.uploadFailed", { status })),
    onProgress,
  );
  return { key, name: file.name };
}

type Progress = { name: string; sent: number; total: number };

const mb = (n: number) => (n / 1048576).toFixed(1);

/** Ход загрузки: имя, процент и мегабайты — видно, идёт ли файл или встал. */
function UploadProgress({ p, t }: { p: Progress; t: AdminT }) {
  const pct = p.total > 0 ? Math.min(100, Math.round((p.sent / p.total) * 100)) : 0;
  return (
    <div className="mt-3 space-y-1" role="status" aria-live="polite">
      <div className="flex justify-between gap-2 text-xs text-muted">
        <span className="min-w-0 truncate">{t("product.uploading", { name: p.name })}</span>
        <span className="shrink-0">
          {pct}% · {t("product.uploadedOf", { sent: mb(p.sent), total: mb(p.total) })}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded bg-line">
        <div className="h-full bg-accent transition-[width]" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/**
 * Разделы товара: поиск и полный путь. Скрытые поиском галочки остаются в
 * форме (display: none), отмеченное не теряется.
 */
function CategoryPicker({
  categories,
  selected,
  t,
}: {
  categories: CategoryOption[];
  selected: string[];
  t: AdminT;
}) {
  const [q, setQ] = useState("");
  const paths = categoryPaths(categories);
  const sorted = [...categories].sort((a, b) =>
    (paths.get(a.id) ?? "").localeCompare(paths.get(b.id) ?? ""),
  );
  const needle = q.trim().toLowerCase();
  const shown = (id: string) => !needle || (paths.get(id) ?? "").toLowerCase().includes(needle);
  const visible = sorted.filter((c) => shown(c.id)).length;
  if (categories.length === 0)
    return <span className="text-sm text-muted">{t("product.noCategories")}</span>;
  return (
    <div className="space-y-2">
      {categories.length > 8 && (
        <input
          className="input"
          type="search"
          placeholder={t("product.categorySearch")}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      )}
      <div className="grid max-h-72 gap-1 overflow-y-auto sm:grid-cols-2">
        {sorted.map((c) => (
          <label
            key={c.id}
            className={`flex items-center gap-2 text-sm ${shown(c.id) ? "" : "hidden"}`}
          >
            <input
              type="checkbox"
              name="categoryIds"
              value={c.id}
              defaultChecked={selected.includes(c.id)}
            />
            <span>
              {c.parent_id && (
                <span className="text-muted">
                  {(paths.get(c.id) ?? "").split(" › ").slice(0, -1).join(" › ")} ›{" "}
                </span>
              )}
              {c.name}
            </span>
          </label>
        ))}
        {visible === 0 && <span className="text-sm text-muted">{t("product.categoryNone")}</span>}
      </div>
    </div>
  );
}

function ProductEditor() {
  const {
    product: p,
    waiting,
    waitlistRun,
    lowStock,
    preorder,
    preorderPast,
    categories,
    countries,
    defaultFulfillment,
  } = Route.useLoaderData();
  const { shop } = Route.useRouteContext();
  const t = adminT(shop.locale);
  const navigate = useNavigate();
  const isNew = !p;
  // Онлайн-школа: товар — это курс, уроки и потоки — главное в карточке.
  const school = shop.vertical === "courses";

  const [images, setImages] = useState<Img[]>(
    (p?.product_images ?? [])
      .slice()
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((i) => ({ key: i.image_path })),
  );
  const [materials, setMaterials] = useState<Mat[]>(editableMaterials(p));
  const [variants, setVariants] = useState<Variant[]>(
    (p?.product_variants ?? [])
      .slice()
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((v) => ({ name: v.name, price: Number(v.price) })),
  );
  const [kind, setKind] = useState<"digital" | "physical">(
    (p?.fulfillment_kind as "digital" | "physical") ?? defaultFulfillment,
  );
  // Курс: уроки вместо файлов. Новый товар онлайн-школы — курс по умолчанию.
  const [isCourse, setIsCourse] = useState<boolean>(
    p ? isCourseProduct(p) : shop.modules.courses && shop.vertical === "courses",
  );
  const [uploading, setUploading] = useState<Progress | null>(null);
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
    const lowAt = num("lowStockAt");
    const preorderFrom = String(f.get("preorderFrom") ?? "");
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
          lowStockAt: lowAt,
          preorderOn: f.get("preorderOn") === "on",
          preorderFrom: /^\d{4}-\d{2}-\d{2}$/.test(preorderFrom) ? preorderFrom : null,
          images: images.map((i) => i.key),
          materials,
          variants: variants.filter((v) => v.name.trim()),
          isCourse: shop.modules.courses && kind === "digital" && isCourse,
        },
      },
    });
    if (isNew) await navigate({ to: "/admin/products/$id", params: { id } });
    else await navigate({ to: "/admin/products" });
  });
  const copy = useAction(async () => {
    if (!p) return;
    const { id } = await copyProductFn({ data: { id: p.id, suffix: t("product.copySuffix") } });
    await navigate({ to: "/admin/products/$id", params: { id } });
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
      setUploading({ name: file.name, sent: 0, total: file.size });
      try {
        const r = await upload(kind, file, t, (sent, total) =>
          setUploading({ name: file.name, sent, total }),
        );
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
        title={isNew ? t(school ? "product.newCourseTitle" : "product.newTitle") : p.name}
        subtitle={
          <Link to="/admin/products" className="hover:underline">
            {t(school ? "product.backToCourses" : "product.backToList")}
          </Link>
        }
        actions={
          <>
            {!isNew && shop.modules.instagram && (
              <Link to="/admin/posts" search={{ product: p.id }} className="btn-secondary">
                {t("product.makePost")}
              </Link>
            )}
            {!isNew && (
              <button
                type="button"
                className="btn-secondary"
                disabled={copy.busy}
                onClick={() => void copy.run().catch(() => {})}
              >
                {t("product.copy")}
              </button>
            )}
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
      <ErrorBox error={save.error ?? del.error ?? copy.error ?? uploadError} />
      <div className="mt-3 grid gap-4 lg:grid-cols-[1fr_340px]">
        <div className="space-y-4">
          {school && isNew && (
            <p className="rounded-md border border-accent/40 bg-accent/5 p-3 text-sm">
              {t("product.courseSaveFirst")}
            </p>
          )}
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
              <DescriptionAssist t={t} kind={kind} currency={p?.currency ?? shop.currency} />
              <Field label={t("product.keywords")} hint={t("product.keywordsHint")}>
                <input className="input" name="keywords" defaultValue={p?.keywords ?? ""} />
              </Field>
              <Field label={t("product.categories")}>
                <CategoryPicker
                  categories={categories}
                  selected={Array.isArray(p?.category_ids) ? (p.category_ids as string[]) : []}
                  t={t}
                />
              </Field>
            </div>
          </Card>
          {school && shop.modules.courses && p?.id && kind === "digital" && (
            <CourseCard productId={p.id} t={t} />
          )}

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
            {shop.modules.multi_currency && countries.length === 0 && (
              <p className="mt-4 text-sm text-muted">
                {t("product.countryPricesEmpty")}{" "}
                <Link to="/admin/settings" className="underline">
                  {t("product.countryPricesSetup")}
                </Link>
              </p>
            )}
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
              <div className="label">
                {t(school ? "product.variantsCourse" : "product.variants")}
              </div>
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
                hint={[
                  t("product.stockHint"),
                  waiting == null
                    ? t("product.waitingUnknown")
                    : waiting > 0
                      ? t("product.waiting", { n: waiting })
                      : "",
                  waitlistRun
                    ? t("product.waitlistLast", {
                        when: new Date(waitlistRun.at).toLocaleString(intlLocale(shop.locale)),
                        notified: waitlistRun.notified,
                        failed: waitlistRun.failed,
                      })
                    : "",
                  waitlistRun && waitlistRun.left > 0
                    ? t("product.waitlistLeft", { n: waitlistRun.left })
                    : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                <input
                  className="input"
                  name="stockQuantity"
                  type="number"
                  min={0}
                  defaultValue={p?.stock_quantity ?? ""}
                />
              </Field>
              {shop.modules.stock && (
                <Field
                  label={t("product.lowStock")}
                  hint={t("product.lowStockHint", { n: lowStock.shop })}
                >
                  <input
                    className="input"
                    name="lowStockAt"
                    type="number"
                    min={0}
                    defaultValue={lowStock.own ?? ""}
                  />
                </Field>
              )}
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
            {shop.modules.stock && kind === "physical" && (
              <div className="mt-3 space-y-2">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="preorderOn" defaultChecked={Boolean(preorder)} />{" "}
                  {t("product.preorder")}
                </label>
                <p className="text-xs text-muted">{t("product.preorderHint")}</p>
                {preorderPast && <p className="text-xs text-danger">{t("product.preorderPast")}</p>}
                <Field label={t("product.preorderFrom")} hint={t("product.preorderFromHint")}>
                  <input
                    className="input sm:w-48"
                    name="preorderFrom"
                    type="date"
                    defaultValue={preorder?.from ?? ""}
                  />
                </Field>
              </div>
            )}
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
              {uploading ? t("product.uploading", { name: uploading.name }) : t("product.addPhoto")}
              <input
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => void onUpload("image", e.target.files)}
              />
            </label>
            {uploading && <UploadProgress p={uploading} t={t} />}
            <p className="mt-1 text-xs text-muted">{t("product.firstIsCover")}</p>
          </Card>

          {shop.modules.courses && kind === "digital" && (
            <label className="card flex items-start gap-2 p-4 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={isCourse}
                onChange={(e) => setIsCourse(e.target.checked)}
              />
              <span>
                {t("product.isCourse")}
                <span className="block text-xs text-muted">{t("product.isCourseHint")}</span>
              </span>
            </label>
          )}
          {kind === "digital" && (
            <Card
              title={t("product.card.files")}
              actions={
                materials.length === 0 && isCourse && shop.modules.courses ? (
                  <Badge>{t("product.filesOptional")}</Badge>
                ) : materials.length === 0 ? (
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
              {uploading && <UploadProgress p={uploading} t={t} />}
              <p className="mt-2 text-xs text-muted">{t("product.filesHint")}</p>
            </Card>
          )}
          {p?.id && kind === "digital" && <PreviewCard productId={p.id} t={t} botId={shop.botId} />}
          {shop.modules.profit && p?.id && (
            <CostCard
              productId={p.id}
              variantNames={[...new Set((p.product_variants ?? []).map((v) => v.name.trim()))]}
              canWrite={canEdit(shop.role) || shop.role === "accountant"}
              t={t}
            />
          )}
          {shop.modules.subscriptions && p?.id && <SubscriptionCard productId={p.id} t={t} />}
          {!school && shop.modules.courses && p?.id && kind === "digital" && (
            <CourseCard productId={p.id} t={t} />
          )}
          {shop.modules.bundles && p?.id && kind === "physical" && (
            <BundleCard productId={p.id} t={t} />
          )}
          {shop.modules.upsell && p?.id && <UpsellCard productId={p.id} t={t} />}
          {shop.modules.stock && p?.id && (
            <StockHistoryCard productId={p.id} locale={shop.locale} t={t} />
          )}
        </div>
      </div>
    </form>
  );
}

type StockHistory = Awaited<ReturnType<typeof stockHistoryFn>>["entries"];

/** «История остатка»: куда делись штуки за 30 дней, страницами по 20. */
function StockHistoryCard({
  productId,
  locale,
  t,
}: {
  productId: string;
  locale: Locale;
  t: AdminT;
}) {
  const [entries, setEntries] = useState<StockHistory>([]);
  const [total, setTotal] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const load = async () => {
    const page = Math.ceil(entries.length / 20);
    try {
      const r = await stockHistoryFn({ data: { productId, page } });
      setEntries((x) => [...x, ...r.entries]);
      setTotal(r.total);
      setFailed(false);
    } catch {
      setFailed(true);
    }
    setLoaded(true);
  };
  useEffect(() => {
    void load();
    // Только при открытии карточки: «Показать ещё» грузит следующую страницу.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId]);
  const amount = (n: number | null) =>
    n === null ? t("product.stockHistory.untracked") : String(n);
  const reason = (e: StockHistory[number]) => {
    const key = `product.stockHistory.reason.${e.reason}` as const;
    if (
      e.reason === "order" ||
      e.reason === "cancel" ||
      e.reason === "refund" ||
      e.reason === "manual_order"
    )
      return e.orderNo === null
        ? t("product.stockHistory.reason.orderGone")
        : t(key, { no: e.orderNo });
    return t(key);
  };
  return (
    <Card title={t("product.card.stockHistory")}>
      <p className="mb-2 text-xs text-muted">{t("product.stockHistory.hint")}</p>
      {failed && <p className="text-sm text-danger">{t("product.stockHistory.failed")}</p>}
      {loaded && !failed && entries.length === 0 && (
        <p className="text-sm text-muted">{t("product.stockHistory.empty")}</p>
      )}
      <ul className="space-y-1 text-sm">
        {entries.map((e) => (
          <li key={e.id} className="flex flex-wrap items-baseline justify-between gap-2">
            <span>
              {reason(e)}
              {e.actor.startsWith("admin:") && e.actor.length > 6 && (
                <span className="text-xs text-muted">
                  {" · "}
                  {t("product.stockHistory.by", { who: e.actor.slice(6) })}
                </span>
              )}
            </span>
            <span className="whitespace-nowrap">
              <span className="text-xs text-muted">
                {new Date(e.at).toLocaleString(intlLocale(locale), {
                  day: "numeric",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                })}{" "}
              </span>
              {amount(e.from)} → <b>{amount(e.to)}</b>
            </span>
          </li>
        ))}
      </ul>
      {entries.length < total && (
        <button type="button" className="btn-ghost mt-2 text-xs" onClick={() => void load()}>
          {t("product.stockHistory.more")}
        </button>
      )}
    </Card>
  );
}

/** «С этим предлагать»: до 10 товаров, которые бот покажет в корзине рядом с этим. */
function UpsellCard({ productId, t }: { productId: string; t: AdminT }) {
  const [loaded, setLoaded] = useState(false);
  // state: в продаже, скрыт или удалён — скрытый и удалённый покупателю не предлагаются.
  const [picked, setPicked] = useState<
    Array<{ id: string; name: string | null; state: "ok" | "hidden" | "deleted" }>
  >([]);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    void upsellForProductFn({ data: { productId } }).then((r) => {
      // Порядок — как сохранён; удалённый товар остаётся в списке с пометкой, чтобы его можно было убрать.
      setPicked(r.targets);
      setLoaded(true);
    });
  }, [productId]);
  const save = useAction(async () => {
    await saveUpsellFn({ data: { productId, ids: picked.map((x) => x.id) } });
    setSaved(true);
  });
  if (!loaded) return null;
  return (
    <Card title={t("product.card.upsell")}>
      <p className="mb-2 text-xs text-muted">{t("product.upsellHint")}</p>
      <ul className="mb-2 space-y-1 text-sm">
        {picked.map((x) => (
          <li key={x.id} className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate">
              {x.name ?? t("product.upsell.deletedName")}
              {x.state !== "ok" && (
                <span className="ml-2 text-xs text-warn">{t(`product.upsell.${x.state}`)}</span>
              )}
            </span>
            <button
              type="button"
              className="btn-ghost text-xs"
              onClick={() => setPicked((p) => p.filter((y) => y.id !== x.id))}
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
      {picked.length < 10 && (
        <div aria-label={t("product.upsellAdd")}>
          <ProductSearch
            t={t}
            exclude={[productId, ...picked.map((x) => x.id)]}
            onPick={(x) =>
              setPicked((p) =>
                p.some((y) => y.id === x.id) || p.length >= 10
                  ? p
                  : [...p, { id: x.id, name: x.name, state: "ok" }],
              )
            }
          />
        </div>
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

/**
 * Черновик описания от ИИ: берёт из формы название, цену, ключевые слова и
 * то, что уже написано в описании, и кладёт текст в поле. Прежний текст
 * можно вернуть одной кнопкой; сохраняет продавец сам.
 */
function DescriptionAssist({
  t,
  kind,
  currency,
}: {
  t: AdminT;
  kind: "digital" | "physical";
  currency: string;
}) {
  const [before, setBefore] = useState<string | null>(null);
  const field = (el: HTMLElement, name: string) =>
    el.closest("form")?.elements.namedItem(name) as HTMLInputElement | HTMLTextAreaElement | null;
  const write = useAction(async (el: HTMLElement) => {
    const area = field(el, "description");
    if (!area) return;
    const { text } = await assistDescriptionFn({
      data: {
        name: field(el, "name")?.value ?? "",
        description: area.value,
        keywords: field(el, "keywords")?.value ?? "",
        price: Number(field(el, "price")?.value) || null,
        currency: field(el, "currency")?.value || currency,
        kind,
      },
    });
    setBefore(area.value);
    area.value = text;
  });
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="btn-secondary text-sm"
          disabled={write.busy}
          onClick={(e) => void write.run(e.currentTarget).catch(() => {})}
        >
          {write.busy ? t("product.assist.busy") : t("product.assist.write")}
        </button>
        {before !== null && (
          <button
            type="button"
            className="btn-ghost text-sm"
            onClick={(e) => {
              const area = field(e.currentTarget, "description");
              if (area) area.value = before;
              setBefore(null);
            }}
          >
            {t("product.assist.undo")}
          </button>
        )}
      </div>
      <p className="text-xs text-muted">{t("product.assist.hint")}</p>
      <ErrorBox error={write.error} />
    </div>
  );
}

/** Пример цифрового товара: до 5 картинок — витрина и кнопка «👀 Пример» в боте. */
function PreviewCard({ productId, t, botId }: { productId: string; t: AdminT; botId: string }) {
  const [keys, setKeys] = useState<string[] | null>(null);
  useEffect(() => {
    void productPreviewFn({ data: { id: productId } }).then(setKeys);
  }, [productId]);
  const save = useAction(async (next: string[]) => {
    setKeys(await saveProductPreviewFn({ data: { id: productId, keys: next } }));
  });
  const add = useAction(async (files: FileList | null) => {
    if (!files?.length || !keys) return;
    const added: string[] = [];
    for (const f of [...files].slice(0, 5 - keys.length))
      added.push((await upload("image", f, t)).key);
    await save.run([...keys, ...added]);
  });
  if (!keys) return null;
  return (
    <Card title={t("product.card.preview")}>
      <p className="mb-2 text-xs text-muted">{t("product.previewHint")}</p>
      <div className="flex flex-wrap gap-2">
        {keys.map((k) => (
          <div key={k} className="relative">
            <img src={imagePath(botId, k)} alt="" className="h-20 w-20 rounded object-cover" />
            <button
              type="button"
              className="absolute -top-2 -right-2 rounded-full bg-danger px-1.5 text-xs text-white"
              onClick={() => void save.run(keys.filter((x) => x !== k)).catch(() => {})}
            >
              ✕
            </button>
          </div>
        ))}
        {keys.length < 5 && (
          <label className="btn-secondary flex h-20 w-20 cursor-pointer items-center justify-center text-xs">
            +
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              className="hidden"
              onChange={(e) => void add.run(e.target.files).catch(() => {})}
            />
          </label>
        )}
      </div>
      <ErrorBox error={add.error ?? save.error} />
    </Card>
  );
}

/** Себестоимость товара и вариантов (core/profit/cost): из неё считается прибыль в аналитике. */
function CostCard({
  productId,
  variantNames,
  canWrite,
  t,
}: {
  productId: string;
  variantNames: string[];
  canWrite: boolean;
  t: AdminT;
}) {
  const [state, setState] = useState<{ currency: string; cost: ProductCost | null } | null>(null);
  useEffect(() => {
    void productCostFn({ data: { id: productId } }).then(setState);
  }, [productId]);
  if (!state) return null;
  return (
    <Card title={t("cost.card")}>
      <CostEditor
        productId={productId}
        variants={variantNames.map((name) => ({ name }))}
        cost={state.cost}
        currency={state.currency}
        canWrite={canWrite}
        t={t}
      />
    </Card>
  );
}

/** Товар-подписка: раз в N дней бот напомнит покупателю продлить (core/catalog/subscription). */
function SubscriptionCard({ productId, t }: { productId: string; t: AdminT }) {
  const [days, setDays] = useState<number | null | undefined>(undefined);
  const [draft, setDraft] = useState("30");
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    void productSubscriptionFn({ data: { id: productId } }).then((r) => {
      setDays(r.days);
      if (r.days) setDraft(String(r.days));
    });
  }, [productId]);
  const save = useAction(async (next: number | null) => {
    setSaved(false);
    const r = await saveProductSubscriptionFn({ data: { id: productId, days: next } });
    setDays(r.days);
    setSaved(true);
  });
  if (days === undefined) return null;
  const n = Number(draft);
  const valid = Number.isInteger(n) && n >= 7 && n <= 365;
  return (
    <Card title={t("product.card.subscription")}>
      <p className="mb-3 text-xs text-muted">{t("product.subscriptionHint")}</p>
      <label className="mb-3 flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={days !== null}
          disabled={save.busy}
          onChange={(e) =>
            void save.run(e.target.checked ? (valid ? n : 30) : null).catch(() => {})
          }
        />
        {t("product.subscriptionOn")}
      </label>
      {days !== null && (
        <div className="flex flex-wrap items-end gap-3">
          <Field label={t("product.subscriptionDays")}>
            <input
              className="input w-28"
              type="number"
              min={7}
              max={365}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
          </Field>
          <button
            className="btn-secondary"
            disabled={save.busy || !valid || n === days}
            onClick={() => void save.run(n).catch(() => {})}
          >
            {t("common.save")}
          </button>
          {saved && <span className="text-xs text-ok">{t("settings.saved")}</span>}
        </div>
      )}
      <ErrorBox error={save.error} />
    </Card>
  );
}
