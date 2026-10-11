import { HelpTip } from "@/app/admin/help-panel";
import { createFileRoute, Link, useBlocker, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { ReadinessCard } from "@/app/admin/product-readiness";
import { ProductToc, SaveBar, SectionHeading, useActiveSection } from "@/app/admin/product-layout";
import { productReadiness } from "@/core/catalog/readiness";
import { BundleCard } from "@/app/admin/bundle-card";
import {
  copyProductFn,
  deleteProductFn,
  productFn,
  saveProductFn,
} from "@/app/admin/products.functions";
import { adminT, intlLocale } from "@/app/i18n/admin";
import { CourseCard } from "@/app/admin/course-card";
import { canEdit } from "@/core/auth/roles";
import { Badge, Card, ErrorBox, Field, PageTitle, useAction } from "@/app/ui";
import { imagePath } from "@/core/catalog/image-url";
import { editableMaterials, MATERIAL_LANGUAGES } from "@/core/catalog/materials";
import { isCourseProduct } from "@/core/courses/marker";
import { localeNames, type Locale } from "@/core/i18n/locale";
import { TopicField } from "@/app/admin/topic-field";
import { cleanTopics, splitKeywords } from "@/core/catalog/topics";
import {
  type Img,
  type Mat,
  type Variant,
  type Progress,
  upload,
  type ProductTab,
  CategoryPicker,
  UploadProgress,
} from "@/app/admin/product-editor/parts";
import {
  DescriptionAssist,
  PreviewCard,
  CostCard,
  SubscriptionCard,
  SupplierCard,
  UpsellCard,
} from "@/app/admin/product-editor/side-cards";
import { StockHistoryCard } from "@/app/admin/product-editor/stock-history";

/** Карточка товара: форма; загрузка, выбор категории и боковые карточки — в app/admin/product-editor/. */

export const Route = createFileRoute("/admin/_authed/products_/$id")({
  loader: ({ params }) => productFn({ data: { id: params.id === "new" ? null : params.id } }),
  component: ProductEditor,
});

/** Обёртка: «Отменить» пересоздаёт редактор, поля и списки возвращаются к сохранённому. */
function ProductEditor() {
  const [version, setVersion] = useState(0);
  return <ProductEditorBody key={version} onReset={() => setVersion((v) => v + 1)} />;
}

function ProductEditorBody({ onReset }: { onReset: () => void }) {
  const {
    product: p,
    waiting,
    waitlistRun,
    lowStock,
    preorder,
    preorderPast,
    categories,
    countries,
    ruCardPrice,
    defaultFulfillment,
    topics: shopTopics,
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
    for (const code of [...countries.map((c) => c.code), ...(ruCardPrice ? ["RU"] : [])]) {
      const v = Number(f.get(`cp_${code}`));
      if (v > 0) countryPrices[code] = v;
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
          // Тема — служебная часть ключевых слов (core/catalog/topics), сервер их соединит.
          topics: cleanTopics(String(f.get("topics") ?? "")),
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
    saved.current = true;
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

  // Вкладки: все панели остаются в форме (скрытые не выпадают из FormData), поэтому поля не теряются.
  const tabs: ProductTab[] = [
    "main",
    "price",
    "stock",
    "photos",
    "variants",
    ...(shop.modules.bundles && p?.id && kind === "physical" ? (["bundle"] as const) : []),
    ...(shop.modules.upsell && p?.id ? (["promo"] as const) : []),
  ];
  // Поля формы для «Готовности»: неуправляемые, поэтому читаем их из формы на каждый ввод.
  const [live, setLive] = useState({
    name: p?.name ?? "",
    description: p?.description ?? "",
    price: p ? Number(p.price) : (null as number | null),
    categories: Array.isArray(p?.category_ids) ? p.category_ids.length : 0,
  });
  const readLive = (form: HTMLFormElement) => {
    const f = new FormData(form);
    const price = String(f.get("price") ?? "").trim();
    setLive({
      name: String(f.get("name") ?? ""),
      description: String(f.get("description") ?? ""),
      price: price === "" ? null : Number(price),
      categories: f.getAll("categoryIds").length,
    });
  };
  const readiness = productReadiness({
    ...live,
    variants: variants.length,
    photos: images.length,
    kind,
    files: materials.length,
    isCourse,
  });
  // Новый вид: все разделы идут подряд в порядке работы над карточкой, вкладок нет.
  const newOrder: ProductTab[] = [
    "main",
    "photos",
    "price",
    "stock",
    "variants",
    "bundle",
    "promo",
  ];
  const panel = (k: ProductTab) => ({
    className: "space-y-4",
    style: { order: newOrder.indexOf(k) },
  });
  const activeSection = useActiveSection(tabs);
  // Несохранённые изменения: предупреждение при уходе со страницы и из карточки.
  const [dirty, setDirty] = useState(false);
  const saved = useRef(false);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setDirty(true);
  }, [images, materials, variants, kind, isCourse]);
  // После первого сохранения нового товара страница та же, но уже с id: счёт несохранённого начинается заново.
  const productId = p?.id;
  useEffect(() => {
    saved.current = false;
    setDirty(false);
  }, [productId]);
  useBlocker({
    shouldBlockFn: () => (dirty && !saved.current ? !confirm(t("product.unsaved")) : false),
    enableBeforeUnload: () => dirty && !saved.current,
  });

  return (
    <form
      onChange={() => setDirty(true)}
      onInput={(e) => readLive(e.currentTarget)}
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
          </>
        }
      />
      <ErrorBox error={save.error ?? del.error ?? copy.error ?? uploadError} />
      <div className="mt-3 max-w-6xl lg:grid lg:grid-cols-[13rem_minmax(0,1fr)] lg:items-start lg:gap-6">
        <aside className="mb-4 min-w-0 lg:mb-0">
          <div className="space-y-4 lg:sticky lg:top-4">
            <ProductToc
              sections={tabs.map((k) => ({ key: k, label: t(`product.tab.${k}`) }))}
              active={activeSection}
              t={t}
            />
            <ReadinessCard r={readiness} t={t} />
          </div>
        </aside>
        <div className="flex min-w-0 flex-col gap-6">
          <div data-tab="main" {...panel("main")}>
            {tabs.includes("main") && (
              <SectionHeading id="main">{t("product.tab.main")}</SectionHeading>
            )}
            {school && isNew && (
              <p className="rounded-md border border-accent/40 bg-accent/5 p-3 text-sm">
                {t("product.courseSaveFirst")}
              </p>
            )}
            <Card title={t("product.card.description")}>
              <div className="space-y-3">
                <Field
                  label={t("product.name")}
                  help={<HelpTip article="products" anchor="name" />}
                >
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
                <Field
                  label={t("product.keywords")}
                  hint={t("product.keywordsHint")}
                  help={<HelpTip article="products" anchor="name" />}
                >
                  <input
                    className="input"
                    name="keywords"
                    defaultValue={splitKeywords(p?.keywords).words}
                  />
                </Field>
                <TopicField
                  t={t}
                  initial={splitKeywords(p?.keywords).topics}
                  existing={shopTopics}
                />
                <Field
                  label={t("product.categories")}
                  help={<HelpTip article="products" anchor="name" />}
                >
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

            <Card
              title={t("product.card.kind")}
              help={<HelpTip article="products" anchor="kind" />}
            >
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
                  <span className="inline-flex items-center gap-1.5">
                    {t("product.isCourse")}
                    <HelpTip article="products" anchor="is-course" />
                  </span>
                  <span className="block text-xs text-muted">{t("product.isCourseHint")}</span>
                </span>
              </label>
            )}
            {kind === "digital" && (
              <Card
                title={t("product.card.files")}
                help={<HelpTip article="products" anchor="files" />}
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
            {p?.id && kind === "digital" && (
              <PreviewCard productId={p.id} t={t} botId={shop.botId} />
            )}
            {!school && shop.modules.courses && p?.id && kind === "digital" && (
              <CourseCard productId={p.id} t={t} />
            )}
          </div>
          <div data-tab="price" {...panel("price")}>
            {tabs.includes("price") && (
              <SectionHeading id="price">{t("product.tab.price")}</SectionHeading>
            )}
            <Card title={t("product.card.price")}>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field
                  label={t("product.basePrice")}
                  help={<HelpTip article="products" anchor="price" />}
                >
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
                <Field
                  label={t("product.currency")}
                  help={<HelpTip article="products" anchor="price" />}
                >
                  <input
                    className="input"
                    name="currency"
                    defaultValue={p?.currency ?? shop.currency}
                    maxLength={3}
                  />
                </Field>
                <Field
                  label={t("product.sortOrder")}
                  help={<HelpTip article="products" anchor="price" />}
                >
                  <input
                    className="input"
                    name="sortOrder"
                    type="number"
                    defaultValue={p?.sort_order ?? 0}
                  />
                </Field>
              </div>
              {ruCardPrice && (
                <div className="mt-4 max-w-xs">
                  <Field
                    label={t("product.ruCardPrice")}
                    hint={t("product.ruCardPriceHint")}
                    help={<HelpTip article="products" anchor="ru-price" />}
                  >
                    <input
                      className="input"
                      name="cp_RU"
                      type="number"
                      min={0}
                      step="0.01"
                      defaultValue={(p?.country_prices as Record<string, number> | null)?.RU ?? ""}
                    />
                  </Field>
                </div>
              )}
              {shop.modules.multi_currency && countries.length === 0 && !ruCardPrice && (
                <p className="mt-4 text-sm text-muted">
                  {t("product.countryPricesEmpty")}{" "}
                  <Link to="/admin/settings" className="underline">
                    {t("product.countryPricesSetup")}
                  </Link>
                </p>
              )}
              {shop.modules.multi_currency && countries.length > 0 && (
                <div className="mt-4">
                  <div className="label flex items-center gap-1.5">
                    {t("product.countryPrices")}
                    <HelpTip article="products" anchor="country-prices" />
                  </div>
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
            </Card>

            {shop.modules.profit && p?.id && (
              <CostCard
                productId={p.id}
                variantNames={[...new Set((p.product_variants ?? []).map((v) => v.name.trim()))]}
                canWrite={canEdit(shop.role) || shop.role === "accountant"}
                t={t}
              />
            )}
            {shop.modules.subscriptions && p?.id && <SubscriptionCard productId={p.id} t={t} />}
          </div>
          <div data-tab="stock" {...panel("stock")}>
            {tabs.includes("stock") && (
              <SectionHeading id="stock">{t("product.tab.stock")}</SectionHeading>
            )}
            <Card title={t("product.card.stock")}>
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                <Field
                  label={t("product.stock")}
                  help={<HelpTip article="products" anchor="stock" />}
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
                    help={<HelpTip article="products" anchor="low-stock" />}
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
                  <Field
                    label={t("product.leadTime")}
                    help={<HelpTip article="products" anchor="lead-time" />}
                  >
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
                  <HelpTip article="products" anchor="on-sale" />
                </label>
              </div>
              {shop.modules.stock && kind === "physical" && (
                <div className="mt-3 space-y-2">
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="preorderOn" defaultChecked={Boolean(preorder)} />{" "}
                    {t("product.preorder")}
                    <HelpTip article="products" anchor="preorder" />
                  </label>
                  <p className="text-xs text-muted">{t("product.preorderHint")}</p>
                  {preorderPast && (
                    <p className="text-xs text-danger">{t("product.preorderPast")}</p>
                  )}
                  <Field
                    label={t("product.preorderFrom")}
                    hint={t("product.preorderFromHint")}
                    help={<HelpTip article="products" anchor="preorder" />}
                  >
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
            {shop.modules.warehouse && kind === "physical" && p?.id && (
              <SupplierCard productId={p.id} canWrite={canEdit(shop.role)} t={t} />
            )}
            {shop.modules.stock && p?.id && (
              <StockHistoryCard productId={p.id} locale={shop.locale} t={t} />
            )}
          </div>
          <div data-tab="photos" {...panel("photos")}>
            {tabs.includes("photos") && (
              <SectionHeading id="photos">{t("product.tab.photos")}</SectionHeading>
            )}
            <Card
              title={t("product.card.photos")}
              help={<HelpTip article="products" anchor="photos" />}
            >
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
                {uploading
                  ? t("product.uploading", { name: uploading.name })
                  : t("product.addPhoto")}
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
          </div>
          <div data-tab="variants" {...panel("variants")}>
            {tabs.includes("variants") && (
              <SectionHeading id="variants">{t("product.tab.variants")}</SectionHeading>
            )}
            <Card
              title={t(school ? "product.variantsCourse" : "product.card.variants")}
              help={<HelpTip article="products" anchor="variants" />}
            >
              <div>
                <p className="mb-2 text-sm text-muted">
                  {t(school ? "product.variantsCourse" : "product.variants")}
                </p>
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
                            x.map((y, j) =>
                              j === i ? { ...y, price: Number(e.target.value) } : y,
                            ),
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
          </div>
          <div data-tab="bundle" {...panel("bundle")}>
            {tabs.includes("bundle") && (
              <SectionHeading id="bundle">{t("product.tab.bundle")}</SectionHeading>
            )}
            {shop.modules.bundles && p?.id && kind === "physical" && (
              <BundleCard productId={p.id} t={t} />
            )}
          </div>
          <div data-tab="promo" {...panel("promo")}>
            {tabs.includes("promo") && (
              <SectionHeading id="promo">{t("product.tab.promo")}</SectionHeading>
            )}
            {shop.modules.upsell && p?.id && <UpsellCard productId={p.id} t={t} />}
          </div>
        </div>
      </div>
      <SaveBar
        dirty={dirty}
        busy={save.busy || Boolean(uploading)}
        onCancel={() => {
          if (confirm(t("product.unsaved"))) {
            saved.current = true;
            onReset();
          }
        }}
        t={t}
      />
    </form>
  );
}
