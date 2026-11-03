import { useEffect, useState } from "react";
import { courseFn, courseLandingFn, saveCourseLandingFn } from "@/app/admin/courses.functions";
import { uploadFile } from "@/app/admin/upload-client";
import type { AdminT } from "@/app/i18n/admin";
import { Card, ErrorBox, useAction } from "@/app/ui";
import { imagePath } from "@/core/catalog/image-url";
import {
  LANDING_LIMITS as L,
  LANDING_THEMES,
  draftFromCourse,
  normalOrder,
  type CourseLanding,
  type LandingBlock,
} from "@/core/courses/landing";

/**
 * «Страница курса на сайте» в карточке курса: шаблон с простым конструктором
 * (core/courses/landing). Блоки заданы заранее — продавец их заполняет,
 * включает и двигает стрелками; тема и цвет — на выбор. Сохраняется своей
 * кнопкой, отдельно от уроков.
 */
export function CourseLandingCard({
  productId,
  productName,
  botId,
  slug,
  t,
}: {
  productId: string;
  productName: string;
  botId: string;
  slug: string | null;
  t: AdminT;
}) {
  const [l, setL] = useState<CourseLanding | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  useEffect(() => {
    void courseLandingFn({ data: { productId } }).then(setL);
  }, [productId]);
  const save = useAction(async () => {
    if (!l) return;
    setL(await saveCourseLandingFn({ data: { productId, landing: l } }));
    setNote(t("courseLanding.saved"));
  });
  const fill = useAction(async () => {
    if (!l) return;
    const c = await courseFn({ data: { productId } });
    const days = [...new Set(Object.values(c.tariffs ?? {}).map((x) => x.accessDays))];
    const accessDays = days.length === 0 ? null : days.length === 1 ? days[0]! : undefined;
    change(
      draftFromCourse(
        l,
        {
          productName,
          lessons: c.lessons.map((x) => ({
            title: x.title,
            homework: Boolean(x.homework),
            preview: Boolean(x.preview),
          })),
          accessDays,
        },
        {
          subtitle: (lessons, modules) =>
            modules > 0
              ? t("courseLanding.d.subtitle", { lessons, modules })
              : t("courseLanding.d.subtitleNoModules", { lessons }),
          faqFormatQ: t("courseLanding.d.formatQ"),
          faqFormatA: (n) => t("courseLanding.d.formatA", { n }),
          faqHomeworkQ: t("courseLanding.d.hwQ"),
          faqHomeworkA: t("courseLanding.d.hwA"),
          faqAccessQ: t("courseLanding.d.accessQ"),
          faqAccessA: (n) =>
            n ? t("courseLanding.d.accessDays", { n }) : t("courseLanding.d.accessForever"),
          faqFreeQ: t("courseLanding.d.freeQ"),
          faqFreeA: t("courseLanding.d.freeA"),
        },
      ),
    );
    setNote(t("courseLanding.fillDone"));
  });
  const upload = async (files: FileList | null, put: (key: string) => void) => {
    for (const file of Array.from(files ?? [])) {
      setUploading(file.name);
      try {
        put(await uploadFile("image", file, t, (status) => t("product.uploadFailed", { status })));
      } catch {
        /* причина — в ErrorBox загрузки нет: файл просто не добавился */
      } finally {
        setUploading(null);
      }
    }
  };
  if (!l) return null;
  function change(next: CourseLanding) {
    setNote(null);
    setL(next);
  }
  const set = <K extends keyof CourseLanding>(k: K, v: CourseLanding[K]) =>
    change({ ...l!, [k]: v });
  const order = normalOrder(l.order);
  const move = (b: LandingBlock, by: -1 | 1) => {
    const o = order.slice();
    const i = o.indexOf(b);
    const j = i + by;
    if (j < 0 || j >= o.length) return;
    [o[i], o[j]] = [o[j]!, o[i]!];
    set("order", o);
  };
  const toggle = (b: LandingBlock) =>
    set("hidden", l.hidden.includes(b) ? l.hidden.filter((x) => x !== b) : [...l.hidden, b]);
  const img = (key: string) => imagePath(botId, key);

  const body: Record<LandingBlock, React.ReactNode> = {
    program: <p className="text-xs text-muted">{t("courseLanding.programAuto")}</p>,
    learn: (
      <textarea
        className="input min-h-28 w-full text-sm"
        value={l.learn.join("\n")}
        placeholder={t("courseLanding.learnHint")}
        onChange={(e) =>
          set(
            "learn",
            e.target.value
              .split("\n")
              .slice(0, L.learn)
              .map((x) => x.slice(0, L.learnItem)),
          )
        }
      />
    ),
    authors: (
      <div className="space-y-3">
        {l.authors.map((a, i) => {
          const edit = (p: Partial<typeof a>) =>
            set(
              "authors",
              l.authors.map((x, k) => (k === i ? { ...x, ...p } : x)),
            );
          return (
            <div key={i} className="flex gap-3 rounded border border-line p-2">
              <label className="shrink-0 cursor-pointer">
                {a.photo ? (
                  <img src={img(a.photo)} alt="" className="h-20 w-20 rounded object-cover" />
                ) : (
                  <span className="flex h-20 w-20 items-center justify-center rounded bg-surface-2 text-xs text-muted">
                    {t("courseLanding.authorPhoto")}
                  </span>
                )}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => void upload(e.target.files, (key) => edit({ photo: key }))}
                />
              </label>
              <div className="min-w-0 flex-1 space-y-1">
                <input
                  className="input w-full text-sm"
                  value={a.name}
                  maxLength={L.authorName}
                  placeholder={t("courseLanding.authorName")}
                  onChange={(e) => edit({ name: e.target.value })}
                />
                <textarea
                  className="input min-h-16 w-full text-sm"
                  value={a.text}
                  maxLength={L.authorText}
                  placeholder={t("courseLanding.authorText")}
                  onChange={(e) => edit({ text: e.target.value })}
                />
                <button
                  type="button"
                  className="btn-ghost text-xs"
                  onClick={() =>
                    set(
                      "authors",
                      l.authors.filter((_, k) => k !== i),
                    )
                  }
                >
                  {t("courseLanding.remove")}
                </button>
              </div>
            </div>
          );
        })}
        {l.authors.length < L.authors && (
          <button
            type="button"
            className="btn-secondary text-xs"
            onClick={() => set("authors", [...l.authors, { photo: null, name: "", text: "" }])}
          >
            + {t("courseLanding.addAuthor")}
          </button>
        )}
      </div>
    ),
    works: (
      <div>
        <div className="flex flex-wrap gap-2">
          {l.works.map((key) => (
            <div key={key} className="relative">
              <img src={img(key)} alt="" className="h-20 w-20 rounded object-cover" />
              <button
                type="button"
                className="absolute -top-2 -right-2 rounded-full bg-surface px-1.5 text-xs shadow"
                aria-label={t("courseLanding.remove")}
                onClick={() =>
                  set(
                    "works",
                    l.works.filter((x) => x !== key),
                  )
                }
              >
                ✕
              </button>
            </div>
          ))}
        </div>
        {l.works.length < L.works && (
          <label className="btn-secondary mt-2 inline-flex cursor-pointer text-xs">
            + {t("courseLanding.worksAdd")}
            <input
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) =>
                void upload(e.target.files, (key) =>
                  setL((c) => c && { ...c, works: [...c.works, key].slice(0, L.works) }),
                )
              }
            />
          </label>
        )}
        <p className="mt-1 text-xs text-muted">{t("courseLanding.worksHint", { max: L.works })}</p>
      </div>
    ),
    quotes: (
      <div className="space-y-2">
        {l.quotes.map((q, i) => {
          const edit = (p: Partial<typeof q>) =>
            set(
              "quotes",
              l.quotes.map((x, k) => (k === i ? { ...x, ...p } : x)),
            );
          return (
            <div key={i} className="space-y-1 rounded border border-line p-2">
              <textarea
                className="input min-h-16 w-full text-sm"
                value={q.text}
                maxLength={L.quoteText}
                placeholder={t("courseLanding.quoteText")}
                onChange={(e) => edit({ text: e.target.value })}
              />
              <div className="flex gap-2">
                <input
                  className="input flex-1 text-sm"
                  value={q.name}
                  maxLength={L.quoteName}
                  placeholder={t("courseLanding.quoteName")}
                  onChange={(e) => edit({ name: e.target.value })}
                />
                <button
                  type="button"
                  className="btn-ghost text-xs"
                  onClick={() =>
                    set(
                      "quotes",
                      l.quotes.filter((_, k) => k !== i),
                    )
                  }
                >
                  {t("courseLanding.remove")}
                </button>
              </div>
            </div>
          );
        })}
        {l.quotes.length < L.quotes && (
          <button
            type="button"
            className="btn-secondary text-xs"
            onClick={() => set("quotes", [...l.quotes, { name: "", text: "" }])}
          >
            + {t("courseLanding.addQuote")}
          </button>
        )}
      </div>
    ),
    faq: (
      <div className="space-y-2">
        {l.faq.map((f, i) => {
          const edit = (p: Partial<typeof f>) =>
            set(
              "faq",
              l.faq.map((x, k) => (k === i ? { ...x, ...p } : x)),
            );
          return (
            <div key={i} className="space-y-1 rounded border border-line p-2">
              <input
                className="input w-full text-sm"
                value={f.q}
                maxLength={L.faqQ}
                placeholder={t("courseLanding.faqQ")}
                onChange={(e) => edit({ q: e.target.value })}
              />
              <textarea
                className="input min-h-16 w-full text-sm"
                value={f.a}
                maxLength={L.faqA}
                placeholder={t("courseLanding.faqA")}
                onChange={(e) => edit({ a: e.target.value })}
              />
              <button
                type="button"
                className="btn-ghost text-xs"
                onClick={() =>
                  set(
                    "faq",
                    l.faq.filter((_, k) => k !== i),
                  )
                }
              >
                {t("courseLanding.remove")}
              </button>
            </div>
          );
        })}
        {l.faq.length < L.faq && (
          <button
            type="button"
            className="btn-secondary text-xs"
            onClick={() => set("faq", [...l.faq, { q: "", a: "" }])}
          >
            + {t("courseLanding.addFaq")}
          </button>
        )}
      </div>
    ),
  };

  return (
    <Card title={t("courseLanding.title")}>
      <p className="mb-3 text-xs text-muted">{t("courseLanding.hint")}</p>
      <label className="mb-3 flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={l.on}
          onChange={(e) => set("on", e.target.checked)}
          data-testid="landing-edit-on"
        />
        {t("courseLanding.on")}
      </label>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="btn-secondary text-sm"
          disabled={fill.busy}
          onClick={() => void fill.run().catch(() => {})}
        >
          ✨ {t("courseLanding.fill")}
        </button>
        <span className="text-xs text-muted">{t("courseLanding.fillHint")}</span>
      </div>
      <ErrorBox error={fill.error} />
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="label">{t("courseLanding.headline")}</span>
          <input
            className="input w-full"
            value={l.headline}
            maxLength={L.headline}
            placeholder={productName || t("courseLanding.headlineHint")}
            onChange={(e) => set("headline", e.target.value)}
          />
        </label>
        <label className="block text-sm">
          <span className="label">{t("courseLanding.subtitle")}</span>
          <input
            className="input w-full"
            value={l.subtitle}
            maxLength={L.subtitle}
            onChange={(e) => set("subtitle", e.target.value)}
          />
        </label>
        <div className="text-sm">
          <span className="label">{t("courseLanding.theme")}</span>
          <div className="flex flex-wrap gap-2">
            {LANDING_THEMES.map((th) => (
              <button
                key={th}
                type="button"
                className={`badge cursor-pointer px-3 py-1.5 ${l.theme === th ? "border-accent bg-accent/10 text-accent" : ""}`}
                onClick={() => set("theme", th)}
              >
                {t(`courseLanding.theme.${th}`)}
              </button>
            ))}
          </div>
        </div>
        <div className="text-sm">
          <span className="label">{t("courseLanding.accent")}</span>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={l.accent ?? "#c2185b"}
              onChange={(e) => set("accent", e.target.value)}
              aria-label={t("courseLanding.accent")}
            />
            <label className="flex items-center gap-1 text-xs">
              <input
                type="checkbox"
                checked={l.accent === null}
                onChange={(e) => set("accent", e.target.checked ? null : "#c2185b")}
              />
              {t("courseLanding.accentShop")}
            </label>
          </div>
        </div>
      </div>
      <h3 className="mt-5 text-sm font-semibold">{t("courseLanding.blocks")}</h3>
      <p className="mb-2 text-xs text-muted">{t("courseLanding.blocksHint")}</p>
      <div className="space-y-2">
        {order.map((b, i) => {
          const shown = !l.hidden.includes(b);
          return (
            <details
              key={b}
              className="rounded border border-line"
              data-testid={`landing-edit-${b}`}
            >
              <summary className="flex cursor-pointer items-center gap-2 p-2 text-sm">
                <span className={`flex-1 font-medium ${shown ? "" : "text-muted line-through"}`}>
                  {t(`courseLanding.block.${b}`)}
                </span>
                <label
                  className="flex items-center gap-1 text-xs"
                  onClick={(e) => e.stopPropagation()}
                >
                  <input type="checkbox" checked={shown} onChange={() => toggle(b)} />
                  {t("courseLanding.show")}
                </label>
                <button
                  type="button"
                  className="btn-ghost px-1 text-xs"
                  disabled={i === 0}
                  aria-label={t("courseLanding.up")}
                  onClick={(e) => {
                    e.preventDefault();
                    move(b, -1);
                  }}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="btn-ghost px-1 text-xs"
                  disabled={i === order.length - 1}
                  aria-label={t("courseLanding.down")}
                  onClick={(e) => {
                    e.preventDefault();
                    move(b, 1);
                  }}
                >
                  ↓
                </button>
              </summary>
              <div className="border-t border-line p-2">{body[b]}</div>
            </details>
          );
        })}
      </div>
      {uploading && (
        <p className="mt-2 text-xs text-muted">
          {t("courseLanding.uploading", { name: uploading })}
        </p>
      )}
      <ErrorBox error={save.error} />
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="btn-primary"
          disabled={save.busy}
          onClick={() => void save.run().catch(() => {})}
        >
          {t("courseLanding.save")}
        </button>
        {slug && (
          <a
            className="btn-secondary"
            href={`/s/${slug}/p/${productId}`}
            target="_blank"
            rel="noreferrer"
          >
            {t("courseLanding.open")}
          </a>
        )}
        {note && <span className="text-sm text-ok">{note}</span>}
      </div>
    </Card>
  );
}
