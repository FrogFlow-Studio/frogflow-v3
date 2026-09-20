import { createFileRoute, Link } from "@tanstack/react-router";
import { legalFn } from "@/app/storefront/storefront.functions";

const TITLES: Record<string, string> = {
  offer: "Публичная оферта",
  privacy: "Политика конфиденциальности",
  requisites: "Реквизиты продавца",
  about: "О продавце",
};

export const Route = createFileRoute("/s/$slug/legal/$doc")({
  loader: ({ params }) =>
    legalFn({
      data: { slug: params.slug, doc: params.doc as "offer" | "privacy" | "requisites" | "about" },
    }),
  component: LegalPage,
});

function LegalPage() {
  const { text } = Route.useLoaderData();
  const { slug, doc } = Route.useParams();
  return (
    <article className="mx-auto max-w-2xl">
      <Link to="/s/$slug" params={{ slug }} className="text-sm text-muted hover:underline">
        ← Каталог
      </Link>
      <h1 className="mt-3 text-xl font-semibold">{TITLES[doc] ?? doc}</h1>
      {text ? (
        <div className="mt-4 text-sm leading-relaxed whitespace-pre-line">{text}</div>
      ) : (
        <p className="mt-4 text-sm text-muted">Документ ещё не опубликован продавцом.</p>
      )}
    </article>
  );
}
