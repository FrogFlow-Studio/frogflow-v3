import { Link } from "@tanstack/react-router";
import type { AdminT } from "@/app/i18n/admin";
import { Card, Empty, PageTitle } from "@/app/ui";
import {
  helpArticle,
  helpGroup,
  HELP_GROUPS,
  parseBody,
  searchHelp,
  type HelpGroup,
} from "@/core/help/articles";
import type { Locale } from "@/core/i18n/locale";
import { ArticleBody } from "./help-article";

const TITLE = { start: "help.start", guide: "help.guide", trouble: "help.trouble" } as const;
const SUB = { start: "help.startSub", guide: "help.guideSub", trouble: "help.troubleSub" } as const;

/**
 * Страница «Помощи»: пункт меню (`group`: быстрый старт, справочник, «что
 * делать, если») или поиск по всем статьям (`group` нет). `a` — открытая статья.
 */
export function HelpView({
  t,
  locale,
  group,
  q,
  a,
  onQuery,
}: {
  t: AdminT;
  locale: Locale;
  group?: HelpGroup;
  q?: string;
  a?: string;
  onQuery: (q: string | undefined) => void;
}) {
  const article = a ? helpArticle(a, locale) : null;
  const searching = Boolean(q?.trim()) || !group;
  const found = searching ? searchHelp(q ?? "", locale) : helpGroup(group!, locale);
  const back = group ? `/admin/help/${group}` : "/admin/help";
  return (
    <>
      <PageTitle
        title={group ? t(TITLE[group]) : t("help.title")}
        subtitle={group ? t(SUB[group]) : t("help.subtitle")}
      />
      <nav className="mb-4 flex flex-wrap gap-2 text-sm" aria-label={t("help.nav")}>
        {HELP_GROUPS.map((g) => (
          <a
            key={g}
            href={`/admin/help/${g}`}
            aria-current={g === group ? "page" : undefined}
            className={`badge ${g === group ? "border-accent/30 bg-accent/10 text-accent" : ""}`}
          >
            {t(TITLE[g])}
          </a>
        ))}
      </nav>
      {article ? (
        <Card>
          <div className="space-y-3 p-4">
            <a
              href={q ? `${back}?q=${encodeURIComponent(q)}` : back}
              className="text-sm text-accent underline"
            >
              {t("help.back")}
            </a>
            <h2 className="text-lg font-semibold">{article.title}</h2>
            <ArticleBody blocks={parseBody(article.body)} />
          </div>
        </Card>
      ) : (
        <>
          <input
            type="search"
            className="input mb-4 w-full"
            value={q ?? ""}
            placeholder={group ? t("help.searchAll") : t("help.search")}
            aria-label={t("help.search")}
            onChange={(e) => onQuery(e.target.value || undefined)}
          />
          <Card>
            {found.length === 0 ? (
              <Empty>{t("help.empty")}</Empty>
            ) : (
              <ol
                className={`divide-y divide-line ${group === "start" && !searching ? "list-decimal pl-8" : ""}`}
              >
                {found.map((x) => (
                  <li key={x.slug}>
                    <a
                      href={`${back}?${q ? `q=${encodeURIComponent(q)}&` : ""}a=${x.slug}`}
                      className="block px-4 py-3 hover:bg-surface-2"
                    >
                      {x.title}
                    </a>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </>
      )}
      <p className="mt-4 text-sm text-muted">
        {t("help.stillStuck")}{" "}
        <Link to="/admin/support" className="text-accent underline">
          {t("help.writeUs")}
        </Link>
      </p>
    </>
  );
}
