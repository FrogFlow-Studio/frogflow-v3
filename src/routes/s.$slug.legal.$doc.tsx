import { createFileRoute, Link } from "@tanstack/react-router";
import { legalFn } from "@/app/storefront/storefront.functions";
import { useStorefrontLocale } from "@/app/storefront/locale";
import type { StorefrontKey } from "@/app/i18n/storefront";

const TITLES: Record<string, StorefrontKey> = {
  offer: "legal.offer",
  privacy: "legal.privacy",
  requisites: "legal.requisites",
  about: "legal.about",
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
  const { t } = useStorefrontLocale();
  const title = TITLES[doc];
  return (
    <article className="mx-auto max-w-2xl">
      <Link to="/s/$slug" params={{ slug }} className="text-sm text-muted hover:underline">
        {t("legal.back")}
      </Link>
      <h1 className="mt-3 text-xl font-semibold">{title ? t(title) : doc}</h1>
      {text ? (
        <div className="mt-4 text-sm leading-relaxed whitespace-pre-line">{text}</div>
      ) : (
        <p className="mt-4 text-sm text-muted">{t("legal.notPublished")}</p>
      )}
    </article>
  );
}
