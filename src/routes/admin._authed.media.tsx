import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { useId, useMemo, useState } from "react";
import { z } from "zod";
import {
  attachModelMediaFn,
  consultantMediaOverviewFn,
  deleteModelMediaFn,
} from "@/app/admin/consultant-media.functions";
import type {
  CatalogModelOverview,
  ConsultantMediaPageData,
  ModelMediaFile,
} from "@/core/consultant/pricelist/media-catalog.server";
import { Card, Empty, ErrorBox, Field, PageTitle, Stat, useAction } from "@/app/ui";
import { adminT, intlLocale, type AdminT } from "@/app/i18n/admin";
import { roleAllows } from "@/core/auth/roles";

const TABS = ["demanded", "without", "video", "photo", "all"] as const;
type Tab = (typeof TABS)[number];

export const Route = createFileRoute("/admin/_authed/media")({
  validateSearch: z.object({
    tab: z.enum(TABS).optional(),
    q: z.string().optional(),
  }),
  beforeLoad: ({ context }) => {
    if (!context.shop.pricelist || !roleAllows(context.shop.role, "manager")) {
      throw redirect({ to: "/admin" });
    }
  },
  loader: () => consultantMediaOverviewFn(),
  component: MediaCatalogPage,
});

function MediaCatalogPage() {
  const data = Route.useLoaderData() as ConsultantMediaPageData;
  const { shop } = Route.useRouteContext();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const router = useRouter();

  const t = adminT(shop.locale);
  const loc = intlLocale(shop.locale);
  const canEdit = shop.role !== "viewer" && shop.role !== "accountant";

  const PAGE_SIZE = 30;
  const [activeTab, setActiveTab] = useState<Tab>(search.tab ?? "all");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [query, setQuery] = useState(search.q ?? "");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [activeVideo, setActiveVideo] = useState<ModelMediaFile | null>(null);

  const setTab = (next: Tab) => {
    setActiveTab(next);
    setVisibleCount(PAGE_SIZE);
    void navigate({
      search: (prev) => ({ ...prev, tab: next === "all" ? undefined : next }),
      replace: true,
    });
  };

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const m of data.models) {
      if (m.category) set.add(m.category);
    }
    return Array.from(set).sort();
  }, [data.models]);

  const filteredModels = useMemo(() => {
    const q = query.trim().toLowerCase();
    return data.models.filter((m) => {
      // Tab filter
      if (activeTab === "demanded" && !(m.demandCount > 0 && !m.hasPhoto && !m.hasVideo))
        return false;
      if (activeTab === "without" && (m.hasPhoto || m.hasVideo)) return false;
      if (activeTab === "video" && !m.hasVideo) return false;
      if (activeTab === "photo" && !m.hasPhoto) return false;

      // Category filter
      if (selectedCategory !== "all" && m.category !== selectedCategory) return false;

      // Search query
      if (q) {
        const inName = m.name.toLowerCase().includes(q);
        const inCat = m.category.toLowerCase().includes(q);
        const inColors = m.colors.some((c) => c.toLowerCase().includes(q));
        if (!inName && !inCat && !inColors) return false;
      }
      return true;
    });
  }, [data.models, activeTab, selectedCategory, query]);

  const tabClass = (on: boolean) =>
    `rounded-full border px-4 py-1.5 text-sm font-medium transition-colors ${
      on
        ? "border-accent bg-accent text-accent-fg shadow-xs"
        : "border-line bg-surface text-muted hover:text-fg hover:border-fg/30"
    }`;

  return (
    <>
      <PageTitle
        title={t("ws.mediaCatalog.title")}
        subtitle={t("ws.mediaCatalog.subtitle")}
      />

      {/* Top Stat Cards */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat
          label={t("ws.mediaCatalog.stat.total")}
          value={data.totalModels}
          hint={data.totalProducts > 0 ? `${data.totalProducts} позиций в прайсе` : `${data.totalMediaFiles} файлов`}
        />
        <Stat
          label={t("ws.mediaCatalog.stat.withMedia")}
          value={data.withMediaCount}
          hint={`${data.totalMediaFiles} фото и видео (${Math.round((data.withMediaCount / (data.totalModels || 1)) * 100)}%)`}
        />
        <Stat
          label={t("ws.mediaCatalog.stat.withoutMedia")}
          value={data.withoutMediaCount}
          hint={data.demandedWithoutMediaCount > 0 ? `из них ${data.demandedWithoutMediaCount} ждут фото` : "требуют фото/видео"}
        />
        <div
          className={`card p-4 transition-colors ${
            data.demandedWithoutMediaCount > 0 ? "border-danger/40 bg-danger/5" : ""
          }`}
        >
          <div className="flex items-center gap-1.5 text-xs font-medium text-danger">
            <span>🔥 {t("ws.mediaCatalog.stat.demanded")}</span>
          </div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-danger">
            {data.demandedWithoutMediaCount}
          </div>
          <div className="mt-1 text-xs text-muted">ждут покупатели</div>
        </div>
      </div>

      {/* Filters and Search Bar */}
      <div className="mb-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div role="tablist" className="flex flex-wrap gap-2">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "all"}
              className={tabClass(activeTab === "all")}
              onClick={() => setTab("all")}
            >
              {t("ws.mediaCatalog.filter.all")}
              <span className="ml-1 text-xs opacity-70">({data.totalModels})</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "demanded"}
              className={`${tabClass(activeTab === "demanded")} relative`}
              onClick={() => setTab("demanded")}
            >
              {t("ws.mediaCatalog.filter.demanded")}
              {data.demandedWithoutMediaCount > 0 && (
                <span className="ml-1.5 inline-flex items-center justify-center rounded-full bg-danger px-1.5 py-0.2 text-xs font-semibold text-white">
                  {data.demandedWithoutMediaCount}
                </span>
              )}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "without"}
              className={tabClass(activeTab === "without")}
              onClick={() => setTab("without")}
            >
              {t("ws.mediaCatalog.filter.without")}
              <span className="ml-1 text-xs opacity-70">({data.withoutMediaCount})</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "video"}
              className={tabClass(activeTab === "video")}
              onClick={() => setTab("video")}
            >
              {t("ws.mediaCatalog.filter.video")}
              <span className="ml-1 text-xs opacity-70">({data.withVideoCount})</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "photo"}
              className={tabClass(activeTab === "photo")}
              onClick={() => setTab("photo")}
            >
              {t("ws.mediaCatalog.filter.photo")}
              <span className="ml-1 text-xs opacity-70">({data.withPhotoCount})</span>
            </button>
          </div>

          {categories.length > 1 && (
            <select
              className="input ml-auto h-9 w-auto text-xs"
              value={selectedCategory}
              onChange={(e) => {
                setSelectedCategory(e.target.value);
                setVisibleCount(PAGE_SIZE);
              }}
            >
              <option value="all">Все категории ({categories.length})</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="relative">
          <input
            type="search"
            className="input w-full pl-9 text-sm"
            placeholder={t("ws.mediaCatalog.search")}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setVisibleCount(PAGE_SIZE);
              void navigate({
                search: (prev) => ({ ...prev, q: e.target.value || undefined }),
                replace: true,
              });
            }}
          />
          <svg
            className="pointer-events-none absolute top-2.5 left-3 h-4 w-4 text-muted"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          {query && (
            <button
              type="button"
              className="absolute top-2 right-2.5 text-xs text-muted hover:text-fg"
              onClick={() => {
                setQuery("");
                setVisibleCount(PAGE_SIZE);
                void navigate({
                  search: (prev) => ({ ...prev, q: undefined }),
                  replace: true,
                });
              }}
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Model Cards List */}
      {filteredModels.length === 0 ? (
        <Empty>
          <div className="py-8 text-center text-muted">
            <p className="text-base font-medium">
              {activeTab === "demanded"
                ? t("ws.mediaCatalog.emptyDemanded")
                : t("ws.mediaCatalog.empty")}
            </p>
          </div>
        </Empty>
      ) : (
        <div className="space-y-4">
          {filteredModels.slice(0, visibleCount).map((model) => (
            <ModelCard
              key={model.id}
              model={model}
              t={t}
              locale={loc}
              canEdit={canEdit}
              onPlayVideo={(m) => setActiveVideo(m)}
              onChanged={router.invalidate}
            />
          ))}

          {filteredModels.length > visibleCount && (
            <div className="flex flex-col items-center justify-center gap-2 py-4">
              <div className="text-xs text-muted">
                Показано {Math.min(visibleCount, filteredModels.length)} из {filteredModels.length} моделей
              </div>
              <div className="flex flex-wrap items-center justify-center gap-2">
                <button
                  type="button"
                  className="btn-secondary text-xs"
                  onClick={() => setVisibleCount((prev) => prev + PAGE_SIZE)}
                >
                  Показать ещё {Math.min(PAGE_SIZE, filteredModels.length - visibleCount)}
                </button>
                {filteredModels.length - visibleCount > PAGE_SIZE && (
                  <button
                    type="button"
                    className="btn-ghost text-xs text-muted hover:text-fg"
                    onClick={() => setVisibleCount(filteredModels.length)}
                  >
                    Показать все ({filteredModels.length})
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Video Preview Modal */}
      {activeVideo && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-xs"
          onClick={() => setActiveVideo(null)}
        >
          <div
            className="relative max-h-[90vh] w-full max-w-2xl overflow-hidden rounded-xl bg-surface p-2 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-2 flex items-center justify-between px-2 pt-1">
              <span className="text-sm font-semibold truncate">
                {activeVideo.name || activeVideo.color || "Видео"}
              </span>
              <button
                type="button"
                className="btn-ghost h-8 w-8 rounded-full p-0 text-muted hover:text-fg"
                onClick={() => setActiveVideo(null)}
              >
                ✕
              </button>
            </div>
            <video
              src={activeVideo.url}
              controls
              autoPlay
              playsInline
              className="max-h-[75vh] w-full rounded-lg bg-black"
            />
          </div>
        </div>
      )}
    </>
  );
}

function requestDeclension(n: number): string {
  const rem10 = n % 10;
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 19) return "раз";
  if (rem10 >= 2 && rem10 <= 4) return "раза";
  return "раз";
}

function ModelCard({
  model,
  t,
  locale,
  canEdit,
  onPlayVideo,
  onChanged,
}: {
  model: CatalogModelOverview;
  t: AdminT;
  locale: string;
  canEdit: boolean;
  onPlayVideo: (m: ModelMediaFile) => void;
  onChanged: () => Promise<unknown> | void;
}) {
  const [showUpload, setShowUpload] = useState(false);
  const [showRequests, setShowRequests] = useState(false);
  const [selectedColor, setSelectedColor] = useState<string>("");
  const [customColor, setCustomColor] = useState<string>("");
  const [file, setFile] = useState<File | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const uploadInputId = useId();

  const isUrgent = model.demandCount > 0 && !model.hasPhoto && !model.hasVideo;

  const uploadAction = useAction(async () => {
    if (!file) return;
    const { uploadFile } = await import("@/app/admin/upload-client");
    const key = await uploadFile(
      "consultantMedia",
      file,
      t as any,
      (status) => `Ошибка загрузки (${status})`,
    );

    const finalColor = selectedColor === "__custom__" ? customColor.trim() : selectedColor;

    await attachModelMediaFn({
      data: {
        key,
        modelName: model.name,
        color: finalColor || undefined,
        name: file.name,
      },
    });

    setFile(null);
    setSelectedColor("");
    setCustomColor("");
    setShowUpload(false);
    await onChanged();
  });

  const deleteAction = useAction(async (id: string) => {
    await deleteModelMediaFn({ data: { id } });
    setConfirmDeleteId(null);
    await onChanged();
  });

  return (
    <Card
      className={`transition-all ${
        isUrgent
          ? "border-danger/50 shadow-xs ring-1 ring-danger/20"
          : "border-line/70 hover:border-line"
      }`}
    >
      <div className="flex flex-col gap-3">
        {/* Header row */}
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-base font-semibold text-fg tracking-tight">{model.name}</h3>
              {model.category && (
                <span className="rounded bg-surface-2 px-2 py-0.5 text-xs text-muted">
                  {model.category}
                </span>
              )}
              {isUrgent && (
                <span className="inline-flex items-center gap-1 rounded-full bg-danger/15 px-2.5 py-0.5 text-xs font-semibold text-danger">
                  🔥 {t("ws.mediaCatalog.demandedBadge", { n: model.demandCount })}
                </span>
              )}
            </div>

            <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
              <span>{t("ws.mediaCatalog.count", { n: model.productsCount })}</span>
              {model.minPriceKzt > 0 && (
                <span>
                  {t("ws.mediaCatalog.prices", {
                    min: model.minPriceKzt.toLocaleString("ru-RU"),
                    max: model.maxPriceKzt.toLocaleString("ru-RU"),
                  })}
                </span>
              )}
              {model.sizes.length > 0 && (
                <span>
                  {t("ws.mediaCatalog.sizes")}{" "}
                  <span className="text-fg/80">{model.sizes.slice(0, 4).join(", ")}</span>
                  {model.sizes.length > 4 && ` +${model.sizes.length - 4}`}
                </span>
              )}
            </div>
          </div>

          {canEdit && (
            <button
              type="button"
              className={`text-xs font-medium px-3 py-1.5 rounded-md transition-colors ${
                showUpload
                  ? "btn-ghost"
                  : isUrgent
                    ? "btn-primary bg-danger hover:bg-danger/90 text-white"
                    : "btn-secondary"
              }`}
              onClick={() => setShowUpload(!showUpload)}
            >
              {showUpload ? t("common.cancel") : `+ ${t("ws.mediaCatalog.uploadBtn")}`}
            </button>
          )}
        </div>

        {/* Customer demand requests accordion */}
        {model.demandCount > 0 && (
          <div className="rounded-md border border-danger/20 bg-danger/5 p-2.5 text-xs text-danger">
            <div className="flex items-center justify-between">
              <span className="font-medium">
                Покупатели просили фото или видео этой модели ({model.demandCount}{" "}
                {requestDeclension(model.demandCount)})
                {model.lastRequestedAt && (
                  <span className="ml-1 text-muted">
                    · последний: {new Date(model.lastRequestedAt).toLocaleDateString(locale)}
                  </span>
                )}
              </span>
              {model.requestsSample.length > 0 && (
                <button
                  type="button"
                  className="font-semibold underline hover:no-underline"
                  onClick={() => setShowRequests(!showRequests)}
                >
                  {showRequests
                    ? t("ws.mediaCatalog.hideRequests")
                    : t("ws.mediaCatalog.showRequests", { n: model.requestsSample.length })}
                </button>
              )}
            </div>

            {showRequests && model.requestsSample.length > 0 && (
              <ul className="mt-2 space-y-1.5 border-t border-danger/20 pt-2 text-fg/80">
                {model.requestsSample.map((req, idx) => (
                  <li key={idx} className="flex flex-wrap items-baseline gap-2">
                    <span className="text-muted font-mono text-[11px]">
                      {new Date(req.at).toLocaleString(locale, {
                        dateStyle: "short",
                        timeStyle: "short",
                      })}
                    </span>
                    {req.contact && <span className="font-semibold text-fg">{req.contact}</span>}
                    {req.text && <span className="italic">«{req.text}»</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* Media gallery */}
        {model.media.length > 0 ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 md:grid-cols-6">
            {model.media.map((m) => (
              <div
                key={m.id}
                className="group relative flex flex-col overflow-hidden rounded-lg border border-line bg-surface-2 transition-all hover:border-fg/40 hover:shadow-xs"
              >
                <div className="relative aspect-square w-full overflow-hidden bg-black/10">
                  {m.kind === "video" ? (
                    <div
                      className="flex h-full w-full cursor-pointer flex-col items-center justify-center bg-black/80 text-white transition-opacity group-hover:bg-black/70"
                      onClick={() => onPlayVideo(m)}
                    >
                      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white/20 backdrop-blur-xs transition-transform group-hover:scale-110">
                        ▶
                      </span>
                      <span className="mt-1 text-[11px] font-medium opacity-90">
                        {t("ws.mediaCatalog.videoBadge")}
                      </span>
                    </div>
                  ) : (
                    <img
                      src={m.url}
                      alt={m.name || model.name}
                      loading="lazy"
                      className="h-full w-full object-cover transition-transform group-hover:scale-105"
                    />
                  )}

                  {/* Badges on preview */}
                  <div className="absolute top-1 left-1 flex gap-1">
                    <span className="rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white backdrop-blur-xs">
                      {m.kind === "video" ? "🎬" : "📷"}
                    </span>
                  </div>

                  {/* Delete button */}
                  {canEdit && (
                    <div className="absolute top-1 right-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                      {confirmDeleteId === m.id ? (
                        <div className="flex gap-1 bg-surface/90 p-1 rounded backdrop-blur-xs shadow-md">
                          <button
                            type="button"
                            className="btn-danger h-6 px-1.5 text-[10px]"
                            disabled={deleteAction.busy}
                            onClick={() => void deleteAction.run(m.id)}
                          >
                            ✓
                          </button>
                          <button
                            type="button"
                            className="btn-ghost h-6 px-1.5 text-[10px]"
                            onClick={() => setConfirmDeleteId(null)}
                          >
                            ✕
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="flex h-6 w-6 items-center justify-center rounded-full bg-black/70 text-white hover:bg-danger transition-colors text-xs"
                          title={t("ws.mediaCatalog.deleteConfirm")}
                          onClick={() => setConfirmDeleteId(m.id)}
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  )}
                </div>

                <div className="p-1.5 text-[11px]">
                  {m.color ? (
                    <span className="font-medium text-fg truncate block" title={m.color}>
                      {m.color}
                    </span>
                  ) : (
                    <span className="text-muted italic block">Любой цвет</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          !showUpload && (
            <div className="flex items-center justify-between rounded-lg border border-dashed border-line p-3 text-xs text-muted">
              <span>{t("ws.mediaCatalog.empty")} — у консультанта нет фото или видео для этого товара.</span>
              {canEdit && (
                <button
                  type="button"
                  className="btn-ghost text-xs text-accent underline"
                  onClick={() => setShowUpload(true)}
                >
                  + {t("ws.mediaCatalog.uploadBtn")}
                </button>
              )}
            </div>
          )
        )}

        {/* Upload form dropzone */}
        {showUpload && canEdit && (
          <div className="mt-2 rounded-lg border border-accent/40 bg-accent/5 p-3 text-xs">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label="Файл (фото или видео)"
                hint={t("ws.mediaCatalog.uploadHint")}
              >
                <input
                  id={uploadInputId}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime"
                  className="input"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
              </Field>

              <Field
                label={t("ws.mediaCatalog.colorOptional")}
                hint="Если файл подходит ко всем цветам — оставьте пустым"
              >
                {model.colors.length > 0 ? (
                  <div className="space-y-1.5">
                    <select
                      className="input"
                      value={selectedColor}
                      onChange={(e) => setSelectedColor(e.target.value)}
                    >
                      <option value="">Любой / общий цвет</option>
                      {model.colors.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                      <option value="__custom__">Другой цвет…</option>
                    </select>
                    {selectedColor === "__custom__" && (
                      <input
                        className="input"
                        placeholder="Введите название цвета"
                        value={customColor}
                        onChange={(e) => setCustomColor(e.target.value)}
                      />
                    )}
                  </div>
                ) : (
                  <input
                    className="input"
                    placeholder="Например: белый, бежевый"
                    value={customColor}
                    onChange={(e) => {
                      setSelectedColor("__custom__");
                      setCustomColor(e.target.value);
                    }}
                  />
                )}
              </Field>
            </div>

            {Boolean(uploadAction.error) && (
              <div className="mt-2">
                <ErrorBox error={uploadAction.error} />
              </div>
            )}

            <div className="mt-3 flex items-center justify-end gap-2">
              <button
                type="button"
                className="btn-ghost text-xs"
                onClick={() => {
                  setShowUpload(false);
                  setFile(null);
                }}
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                className="btn-primary text-xs"
                disabled={!file || uploadAction.busy}
                onClick={() => void uploadAction.run()}
              >
                {uploadAction.busy ? "Загрузка…" : t("ws.mediaCatalog.uploadBtn")}
              </button>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
