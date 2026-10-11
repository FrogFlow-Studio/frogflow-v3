import type { HelpBlock, HelpPart } from "@/core/help/articles";

/** Ссылка статьи на другую статью: `/admin/help?a=<slug>` (боковая панель открывает её у себя). */
export function articleLinkSlug(href: string): string | null {
  return /^\/admin\/help\?a=([a-z0-9-]+)$/.exec(href)?.[1] ?? null;
}

function Parts({ parts, onArticle }: { parts: HelpPart[]; onArticle?: (slug: string) => void }) {
  return (
    <>
      {parts.map((p, i) => {
        if (!p.href) return <span key={i}>{p.text}</span>;
        const slug = articleLinkSlug(p.href);
        return (
          // Ссылки статей — обычные адреса админки внутри этого же сайта.
          <a
            key={i}
            href={p.href}
            className="text-accent underline"
            onClick={(e) => {
              if (slug && onArticle) {
                e.preventDefault();
                onArticle(slug);
              }
            }}
          >
            {p.text}
          </a>
        );
      })}
    </>
  );
}

/** Тело статьи «Помощи»: подзаголовки с якорями `help-<id>`, абзацы, списки. */
export function ArticleBody({
  blocks,
  onArticle,
  highlight,
}: {
  blocks: HelpBlock[];
  /** Ссылка на другую статью: панель открывает её у себя, не уходя со страницы. */
  onArticle?: (slug: string) => void;
  /** Якорь, к которому привёл «?» — подсвечивается. */
  highlight?: string;
}) {
  return (
    <div className="space-y-3">
      {blocks.map((b, i) => {
        if (b.type === "h")
          return (
            <h3
              key={i}
              id={b.id ? `help-${b.id}` : undefined}
              className={`scroll-mt-4 pt-2 text-base font-semibold ${
                b.id && b.id === highlight ? "rounded bg-accent/10 px-2 py-1" : ""
              }`}
            >
              {b.text}
            </h3>
          );
        if (b.type === "ol" || b.type === "ul") {
          const items = b.items.map((it, j) => (
            <li key={j}>
              <Parts parts={it} onArticle={onArticle} />
            </li>
          ));
          return b.type === "ol" ? (
            <ol key={i} className="list-decimal space-y-1 pl-5 text-sm">
              {items}
            </ol>
          ) : (
            <ul key={i} className="list-disc space-y-1 pl-5 text-sm">
              {items}
            </ul>
          );
        }
        return (
          <p key={i} className="text-sm">
            <Parts parts={b.parts} onArticle={onArticle} />
          </p>
        );
      })}
    </div>
  );
}
