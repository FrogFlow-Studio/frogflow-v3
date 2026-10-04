import type { TenantContext } from "@/core/tenant/resolve.server";
import { PRODUCT_SELECT, sortedImages, type Product } from "@/core/catalog/catalog";
import { imagePath } from "@/core/catalog/image-url";
import { productSellable } from "@/core/catalog/materials";
import { listAllCategories } from "@/core/catalog/admin";
import { customHostProblem, normalizeHost } from "@/core/tenant/custom-domain";
import type { Tenant } from "@/core/tenant/types";
import { productOnStorefront, visibleCategoryIds } from "./categories";
import { storefrontOpen } from "./access";
import { serverFailure } from "@/lib/server-failure";

/** Сколько первых товаров витрины просматриваем в поисках фото для превью. */
const COVER_SCAN = 30;

/**
 * Картинка превью витрины: фото первого товара, который виден на витрине
 * (тот же порядок и те же фильтры, что в каталоге). Товар из скрытой
 * категории или без материалов картинкой магазина не становится.
 */
export async function storeCover(ctx: TenantContext): Promise<string | null> {
  if (!storefrontOpen(ctx.tenant, "catalog")) return null;
  const [{ data, error }, cats] = await Promise.all([
    ctx.db
      .from("products")
      .select(PRODUCT_SELECT)
      .eq("is_active", true)
      .order("sort_order")
      .order("name")
      .order("id")
      .limit(COVER_SCAN),
    listAllCategories(ctx),
  ]);
  if (error) throw serverFailure(error.message);
  const known = new Set(cats.map((c) => c.id));
  const visible = visibleCategoryIds(cats);
  for (const p of (data ?? []) as Product[]) {
    const ids = Array.isArray(p.category_ids) ? (p.category_ids as string[]) : [];
    if (!productOnStorefront(ids, known, visible) || !productSellable(p)) continue;
    const img = sortedImages(p)[0];
    if (img) return imagePath(ctx.tenant.id, img.image_path);
  }
  return null;
}

/**
 * Адрес, от которого строятся абсолютные ссылки в превью: свой домен
 * магазина, если запрос пришёл на него, иначе адрес платформы. Хост чужого
 * магазина или незнакомый хост ссылкой не становится.
 */
export function shareOrigin(t: Pick<Tenant, "settings">, requestUrl: string, appUrl: string) {
  let host: string | null = null;
  try {
    host = normalizeHost(new URL(requestUrl).host);
  } catch {
    host = null;
  }
  const own = host
    ? t.settings.hosts?.some(
        (h) => normalizeHost(h) === host && customHostProblem(h, appUrl) === null,
      )
    : false;
  return own ? `https://${host}` : appUrl.replace(/\/+$/, "");
}

/**
 * Адрес для canonical: свой домен магазина, если он настроен без ошибок
 * (карта сайта такого магазина отдаётся только с него), иначе адрес
 * платформы — где бы покупатель ни открыл страницу.
 */
export function canonicalOrigin(t: Pick<Tenant, "settings">, appUrl: string): string {
  const own = t.settings.hosts?.find((h) => customHostProblem(h, appUrl) === null);
  return own ? `https://${normalizeHost(own)}` : appUrl.replace(/\/+$/, "");
}
