import { CERT_CODE_RE, certificateNo } from "@/core/courses/certificate";
import { certificateByCode } from "@/core/courses/certificate.server";
import { storefrontOpen } from "@/core/storefront/access";
import { SHOP_SLUG_RE } from "@/core/tenant/slug";
import { storefrontBase } from "@/core/tenant/custom-domain";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Certificate } from "@/core/courses/certificate";

/**
 * Проверка и файл сертификата на витрине: по коду, без входа. Магазин должен
 * быть на v2 с открытым модулем «Курсы» (правило 6), иначе «не найдено» —
 * как и для кода, которого нет. Подобрать 12-значный код перебором нельзя, но
 * запросы всё равно считаются (как у страницы курса).
 */
export async function openCertificate(
  slug: string,
  code: string,
): Promise<{ ctx: TenantContext; cert: Certificate } | null> {
  if (!SHOP_SLUG_RE.test(slug) || !CERT_CODE_RE.test(code)) return null;
  const { resolveTenant, tenantContext } = await import("@/core/tenant/resolve.server");
  const t = await resolveTenant({ by: "slug", value: slug });
  if (!t || !storefrontOpen(t, "course")) return null;
  const ctx = tenantContext(t);
  const { takeCourse } = await import("@/core/storefront/rate-limit");
  if (!(await takeCourse(ctx, code))) return null;
  const cert = await certificateByCode(ctx, code);
  return cert ? { ctx, cert } : null;
}

export type CertificateView = {
  student: string;
  course: string;
  issuedAt: string;
  no: string;
  shop: string;
  pdfPath: string;
};

export async function certificateView(slug: string, code: string): Promise<CertificateView | null> {
  const found = await openCertificate(slug, code);
  if (!found) return null;
  return {
    student: found.cert.student,
    course: found.cert.course,
    issuedAt: found.cert.issuedAt,
    no: certificateNo(found.cert.no),
    shop: found.ctx.tenant.name,
    pdfPath: `/s/${encodeURIComponent(slug)}/cert/${code}/pdf`,
  };
}

export async function certificateResponse(slug: string, code: string): Promise<Response> {
  const found = await openCertificate(slug, code);
  if (!found) return new Response("Not found", { status: 404 });
  const { ctx, cert } = found;
  const { certificatePdf } = await import("@/core/courses/certificate-pdf.server");
  const pdf = await certificatePdf(cert, {
    locale: ctx.tenant.settings.default_locale ?? "ru",
    timezone: ctx.timezone,
    shop: ctx.tenant.name,
    url: `${storefrontBase(ctx.tenant, ctx.appUrl)}/cert/${cert.code}`,
  });
  return new Response(pdf as BodyInit, {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="certificate-${certificateNo(cert.no)}.pdf"`,
      "cache-control": "private, max-age=300",
      "x-robots-tag": "noindex",
    },
  });
}
