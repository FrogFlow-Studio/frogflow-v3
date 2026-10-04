import { createFileRoute, Link } from "@tanstack/react-router";
import { z } from "zod";
import { adminT } from "@/app/i18n/admin";
import { Card, Empty, PageTitle } from "@/app/ui";
import { helpArticle, parseBody, searchHelp, type HelpPart } from "@/core/help/articles";

export const Route = createFileRoute("/admin/_authed/help")({
  validateSearch: z.object({ q: z.string().max(200).optional(), a: z.string().max(80).optional() }),
  component: HelpPage,
});

function Parts({ parts }: { parts: HelpPart[] }) {
  return (
    <>
      {parts.map((p, i) =>
        p.href ? (
          // Ссылки статей — обычные адреса админки внутри этого же сайта.
          <a key={i} href={p.href} className="text-accent underline">
            {p.text}
          </a>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  );
}

/** Помощь: поиск по статьям на языке панели и сама статья. Статьи — docs/help, таблицы нет. */
function HelpPage() {
  const { shop } = Route.useRouteContext();
  const t = adminT(shop.locale);
  const { q, a } = Route.useSearch();
  const navigate = Route.useNavigate();
  const article = a ? helpArticle(a, shop.locale) : null;
  const found = searchHelp(q ?? "", shop.locale);
  return (
    <>
      <PageTitle title={t("help.title")} subtitle={t("help.subtitle")} />
      {article ? (
        <Card>
          <div className="space-y-3 p-4">
            <Link to="/admin/help" search={{ q }} className="text-sm text-accent underline">
              {t("help.back")}
            </Link>
            <h2 className="text-lg font-semibold">{article.title}</h2>
            {parseBody(article.body).map((b, i) =>
              b.type === "ol" ? (
                <ol key={i} className="list-decimal space-y-1 pl-5 text-sm">
                  {b.items.map((it, j) => (
                    <li key={j}>
                      <Parts parts={it} />
                    </li>
                  ))}
                </ol>
              ) : (
                <p key={i} className="text-sm">
                  <Parts parts={b.parts} />
                </p>
              ),
            )}
          </div>
        </Card>
      ) : (
        <>
          <input
            type="search"
            className="input mb-4 w-full"
            value={q ?? ""}
            placeholder={t("help.search")}
            aria-label={t("help.search")}
            onChange={(e) =>
              void navigate({ search: { q: e.target.value || undefined }, replace: true })
            }
          />
          <Card>
            {found.length === 0 ? (
              <Empty>{t("help.empty")}</Empty>
            ) : (
              <ul className="divide-y divide-line">
                {found.map((x) => (
                  <li key={x.slug}>
                    <Link
                      to="/admin/help"
                      search={{ q, a: x.slug }}
                      className="block px-4 py-3 hover:bg-surface-2"
                    >
                      {x.title}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
      <p className="mt-4 text-sm text-muted">
        {t("help.stillStuck")}{" "}
        <a href="/admin/support" className="text-accent underline">
          {t("help.writeUs")}
        </a>
      </p>
    </>
  );
}
