import { SHOP_SLUG_RE } from "@/core/tenant/slug";

const UUID_RE = /^[0-9a-f-]{36}$/i;
const INDEX_RE = /^\d{1,3}$/;

/**
 * Переход по ссылке на файл открытого урока: проверяем магазин (витрина
 * открыта, клиент на v2), товар, что урок открытый и путь файла принадлежит
 * магазину, считаем лимит и отдаём 302 на свежую подписанную ссылку.
 * Всё прочее — 404 без подробностей; лимит исчерпан — 429.
 */
export async function courseFileResponse(
  slug: string,
  productId: string,
  noRaw: string,
  idxRaw: string,
): Promise<Response> {
  const notFound = () => new Response("Not found", { status: 404 });
  if (
    !SHOP_SLUG_RE.test(slug) ||
    !UUID_RE.test(productId) ||
    !INDEX_RE.test(noRaw) ||
    !INDEX_RE.test(idxRaw)
  )
    return notFound();
  const { resolveTenant, tenantContext } = await import("@/core/tenant/resolve.server");
  const { storefrontOpen } = await import("@/core/storefront/access");
  const t = await resolveTenant({ by: "slug", value: slug });
  if (!t || !storefrontOpen(t, "catalog")) return notFound();
  const ctx = tenantContext(t);
  const { takeCourseFile } = await import("@/core/storefront/rate-limit");
  if (!(await takeCourseFile(ctx, productId)))
    return new Response("Too many requests", { status: 429, headers: { "retry-after": "60" } });
  const { storeProduct } = await import("@/core/storefront/catalog");
  const product = await storeProduct(ctx, productId);
  if (!product || product.kind !== "digital") return notFound();
  const { openLessonFile } = await import("@/core/courses/preview.server");
  const { signedFileUrl } = await import("@/core/orders/orders");
  const url = await openLessonFile(ctx, productId, Number(noRaw), Number(idxRaw), (path, name) =>
    signedFileUrl(path, 3600, name ?? undefined),
  );
  if (!url) return notFound();
  return new Response(null, {
    status: 302,
    headers: { location: url, "cache-control": "no-store", "x-robots-tag": "noindex" },
  });
}
