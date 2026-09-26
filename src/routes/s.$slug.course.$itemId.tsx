import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { courseViewFn, markLessonFn } from "@/app/storefront/course.functions";
import { useStorefrontLocale } from "@/app/storefront/locale";
import { intlLocale } from "@/app/i18n/admin";
import { ErrorBox, useAction } from "@/app/ui";

/**
 * Купленный курс: покупатель приходит по ссылке из сообщения о выдаче
 * (`?k=` — подпись позиции заказа). Открытые уроки — с текстом, файлами и
 * отметкой «пройден», закрытые — только название и дата открытия.
 */
export const Route = createFileRoute("/s/$slug/course/$itemId")({
  validateSearch: (s: Record<string, unknown>) => ({ k: typeof s.k === "string" ? s.k : "" }),
  loaderDeps: ({ search }) => ({ k: search.k }),
  loader: ({ params, deps }) =>
    courseViewFn({ data: { slug: params.slug, itemId: params.itemId, k: deps.k } }),
  head: () => ({ meta: [{ name: "robots", content: "noindex" }] }),
  component: CoursePage,
});

function CoursePage() {
  const view = Route.useLoaderData();
  const { slug, itemId } = Route.useParams();
  const { k } = Route.useSearch();
  const { t, locale } = useStorefrontLocale();
  const [done, setDone] = useState(
    () => new Set(view.lessons.filter((l) => l.done).map((l) => l.id)),
  );
  const mark = useAction(async (lessonId: string, on: boolean) => {
    const r = await markLessonFn({ data: { slug, itemId, k, lessonId, done: on } });
    setDone(new Set(r.done));
  });
  const date = (iso: string) =>
    new Date(iso).toLocaleDateString(intlLocale(locale), { day: "numeric", month: "long" });
  const opened = view.lessons.filter((l) => l.open).length;

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold text-balance">{view.name}</h1>
        <p className="text-sm text-muted tabular-nums">
          {t("course.progress", { done: done.size, total: view.lessons.length })}
        </p>
        {view.nextAt && (
          <p className="text-sm text-muted">{t("course.next", { date: date(view.nextAt) })}</p>
        )}
      </header>
      <ErrorBox error={mark.error} />
      <ol className="space-y-3">
        {view.lessons.map((l) => (
          <li
            key={l.id}
            className={`rounded-md border border-line p-4 ${l.open ? "" : "opacity-60"}`}
          >
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="font-medium">
                <span className="text-muted">{t("course.lesson", { no: l.no })}.</span> {l.title}
              </h2>
              {!l.open && (
                <span className="shrink-0 text-xs text-muted">
                  {t("course.locked", { date: date(l.opensAt) })}
                </span>
              )}
            </div>
            {l.open && (
              <div className="mt-2 space-y-2 text-sm">
                {l.text && <p className="leading-relaxed whitespace-pre-line">{l.text}</p>}
                {l.link && (
                  <a
                    href={l.link}
                    target="_blank"
                    rel="noreferrer"
                    className="text-accent hover:underline"
                  >
                    {t("course.openLink")}
                  </a>
                )}
                {l.files.length > 0 && (
                  <ul className="space-y-1">
                    {l.files.map((f) => (
                      <li key={f.url}>
                        <a
                          href={f.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-accent hover:underline"
                        >
                          📁 {f.name}
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
                <button
                  type="button"
                  className={done.has(l.id) ? "btn-secondary text-xs" : "btn-primary text-xs"}
                  disabled={mark.busy}
                  onClick={() => void mark.run(l.id, !done.has(l.id)).catch(() => {})}
                >
                  {done.has(l.id) ? t("course.done") : t("course.markDone")}
                </button>
              </div>
            )}
          </li>
        ))}
      </ol>
      {opened > 0 && view.lessons.some((l) => l.files.length > 0) && (
        <p className="text-xs text-muted">{t("course.linkHint")}</p>
      )}
    </div>
  );
}
