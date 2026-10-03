import { createFileRoute } from "@tanstack/react-router";
import { certificateViewFn } from "@/app/storefront/certificate.functions";
import { useStorefrontLocale } from "@/app/storefront/locale";
import { intlLocale } from "@/app/i18n/admin";

/**
 * Проверка сертификата по коду: кто, какой курс, когда выдан. Адрес из
 * PDF. Не для поисковиков: код — личный.
 */
export const Route = createFileRoute("/s/$slug/cert/$code")({
  loader: ({ params }) => certificateViewFn({ data: { slug: params.slug, code: params.code } }),
  head: () => ({ meta: [{ name: "robots", content: "noindex" }] }),
  errorComponent: NotFoundCert,
  notFoundComponent: NotFoundCert,
  component: CertificatePage,
});

function NotFoundCert() {
  const { t } = useStorefrontLocale();
  return <p className="mx-auto max-w-md text-center text-sm">{t("course.cert.notFound")}</p>;
}

function CertificatePage() {
  const c = Route.useLoaderData();
  const { t, locale } = useStorefrontLocale();
  const date = new Date(c.issuedAt).toLocaleDateString(intlLocale(locale), {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  return (
    <article className="mx-auto max-w-md space-y-3 rounded-md border border-line p-6 text-center">
      <p className="text-sm font-medium text-ok">✓ {t("course.cert.valid")}</p>
      <p className="text-sm text-muted">{t("course.cert.certifies")}</p>
      <h1 className="text-xl font-semibold text-balance">{c.student}</h1>
      <p className="text-sm text-muted">{t("course.cert.completed")}</p>
      <p className="font-medium text-balance">«{c.course}»</p>
      <p className="text-xs text-muted tabular-nums">
        {t("course.cert.issued", { date })} · {t("course.cert.number", { no: c.no })}
      </p>
      <p className="text-xs text-muted">{c.shop}</p>
      <a href={c.pdfPath} className="btn-primary inline-block" target="_blank" rel="noreferrer">
        {t("course.cert.download")}
      </a>
    </article>
  );
}
