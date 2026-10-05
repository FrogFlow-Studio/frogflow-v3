import { publicHeaders } from "@/app/cache-policy";
import { createFileRoute, Link } from "@tanstack/react-router";
import { z } from "zod";
import { marketHeadLinks } from "@/app/market/seo";
import { RULES_SECTIONS, rulesT } from "@/app/market/rules-i18n";
import { SUPPORTED_LOCALES, type Locale } from "@/core/i18n/locale";

/** Правила площадки (В12): что она делает на самом деле — согласие, одобрение, скрытие. */
export const Route = createFileRoute("/market/rules")({
  headers: publicHeaders,
  validateSearch: z.object({ lang: z.enum(SUPPORTED_LOCALES).optional().catch(undefined) }),
  head: ({ match }) => {
    const t = rulesT(match.search.lang ?? "ru");
    return {
      meta: [{ title: t("meta.title") }, { name: "description", content: t("meta.description") }],
      links: marketHeadLinks("/market/rules", match.search.lang ?? "ru"),
    };
  },
  component: RulesPage,
});

function RulesPage() {
  const search = Route.useSearch();
  const locale: Locale = search.lang ?? "ru";
  const t = rulesT(locale);
  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <div className="flex items-center justify-between gap-3">
        <Link
          to="/"
          search={search.lang ? { lang: search.lang } : {}}
          className="text-lg font-semibold"
        >
          🐸 FrogFlow
        </Link>
        <nav className="flex gap-2 text-sm">
          {SUPPORTED_LOCALES.map((l) => (
            <Link
              key={l}
              to="/market/rules"
              search={{ lang: l }}
              className={l === locale ? "font-medium" : "text-muted"}
            >
              {l.toUpperCase()}
            </Link>
          ))}
        </nav>
      </div>
      <h1 className="mt-6 text-2xl font-semibold">{t("title")}</h1>
      <p className="mt-2 text-sm text-muted">{t("lead")}</p>
      <ol className="mt-6 space-y-5">
        {RULES_SECTIONS.map((k, i) => (
          <li key={k} id={k} className="scroll-mt-4">
            <h2 className="font-medium">
              {i + 1}. {t(`${k}.title`)}
            </h2>
            <p className="mt-1 text-sm">{t(`${k}.text`)}</p>
          </li>
        ))}
      </ol>
      <p className="mt-8 flex gap-4 text-sm">
        <Link to="/market" search={search.lang ? { lang: search.lang } : {}} className="underline">
          {t("link.market")}
        </Link>
        <Link to="/" search={search.lang ? { lang: search.lang } : {}} className="underline">
          {t("link.home")}
        </Link>
      </p>
    </main>
  );
}
