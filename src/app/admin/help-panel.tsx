import { useRouterState } from "@tanstack/react-router";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { AdminT } from "@/app/i18n/admin";
import type { Locale } from "@/core/i18n/locale";
import { ArticleBody } from "./help-article";

/**
 * «?» и боковая панель «Помощи»: у заголовка каждой страницы и рядом с
 * переключателями. Панель открывает статью (и место в ней) поверх страницы,
 * не уводя с неё — введённое в форму не пропадает. Статьи грузятся только
 * при первом открытии: в общий код админки они не попадают.
 */
type Target = { slug?: string; anchor?: string; path?: string };
const Ctx = createContext<{ open: (t: Target) => void; tip: string; page: string } | null>(null);

type Articles = typeof import("@/core/help/articles");
let loading: Promise<Articles> | null = null;
const loadArticles = () => (loading ??= import("@/core/help/articles"));

export function HelpPanelProvider({
  locale,
  t,
  children,
}: {
  locale: Locale;
  t: AdminT;
  children: ReactNode;
}) {
  const [target, setTarget] = useState<Target | null>(null);
  const [mod, setMod] = useState<Articles | null>(null);
  const box = useRef<HTMLDivElement>(null);

  const open = (x: Target) => {
    setTarget(x);
    void loadArticles().then(setMod);
  };

  useEffect(() => {
    if (!target) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setTarget(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [target]);

  const article =
    !target || !mod
      ? null
      : target.slug
        ? mod.helpArticle(target.slug, locale)
        : target.path
          ? mod.helpForPath(target.path, locale)
          : null;

  // К месту в статье: якорь переключателя, иначе — начало.
  useEffect(() => {
    const el = box.current;
    if (!el || !article) return;
    const at = target?.anchor ? el.querySelector(`#help-${target.anchor}`) : null;
    if (at) at.scrollIntoView({ block: "start" });
    else el.scrollTop = 0;
  }, [article, target?.anchor]);

  return (
    <Ctx.Provider value={{ open, tip: t("help.tip"), page: t("help.pageTip") }}>
      {children}
      {target && (
        <div className="fixed inset-0 z-50 flex justify-end" role="presentation">
          <button
            type="button"
            aria-label={t("help.close")}
            className="absolute inset-0 bg-black/30"
            onClick={() => setTarget(null)}
          />
          <aside
            role="dialog"
            aria-modal="true"
            aria-label={article?.title ?? t("help.title")}
            className="relative flex h-full w-full max-w-md flex-col border-l border-line bg-surface shadow-xl"
          >
            <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
              <h2 className="text-sm font-semibold">{article?.title ?? t("help.title")}</h2>
              <button type="button" className="btn-ghost" onClick={() => setTarget(null)}>
                {t("help.close")}
              </button>
            </header>
            <div ref={box} className="flex-1 overflow-y-auto p-4">
              {!mod ? (
                <p className="text-sm text-muted">{t("help.loading")}</p>
              ) : article ? (
                <ArticleBody
                  blocks={mod.parseBody(article.body)}
                  highlight={target.anchor}
                  onArticle={(slug) => setTarget({ slug })}
                />
              ) : (
                <>
                  <p className="mb-3 text-sm text-muted">{t("help.noPage")}</p>
                  <ul className="divide-y divide-line">
                    {mod.helpGroup("guide", locale).map((a) => (
                      <li key={a.slug}>
                        <button
                          type="button"
                          className="block w-full px-1 py-2 text-left text-sm hover:bg-surface-2"
                          onClick={() => setTarget({ slug: a.slug })}
                        >
                          {a.title}
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
            {article && (
              <footer className="border-t border-line px-4 py-3">
                <a
                  href={`/admin/help/${article.group ?? "guide"}?a=${article.slug}`}
                  className="text-sm text-accent underline"
                >
                  {t("help.openFull")}
                </a>
              </footer>
            )}
          </aside>
        </div>
      )}
    </Ctx.Provider>
  );
}

/**
 * «?» рядом с переключателем или полем: открывает статью `article` на
 * подзаголовке `{#anchor}`. Вне админки (нет панели) не рисуется.
 */
export function HelpTip({ article, anchor }: { article: string; anchor?: string }) {
  const ctx = useContext(Ctx);
  if (!ctx) return null;
  return (
    <button
      type="button"
      className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-line text-xs text-muted hover:border-accent hover:text-accent"
      aria-label={ctx.tip}
      title={ctx.tip}
      data-help={anchor ? `${article}#${anchor}` : article}
      onClick={(e) => {
        // «?» внутри <label> не должен щёлкать переключатель.
        e.preventDefault();
        e.stopPropagation();
        ctx.open({ slug: article, anchor });
      }}
    >
      ?
    </button>
  );
}

/** «?» у заголовка страницы: статья, объявившая адрес этой страницы в `pages:`. */
export function PageHelp() {
  const ctx = useContext(Ctx);
  const path = useRouterState({ select: (s) => s.location.pathname });
  if (!ctx) return null;
  return (
    <button
      type="button"
      className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-line text-sm text-muted hover:border-accent hover:text-accent"
      aria-label={ctx.page}
      title={ctx.page}
      onClick={() => ctx.open({ path })}
    >
      ?
    </button>
  );
}
