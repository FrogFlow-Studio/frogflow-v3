import { getRequestUrl } from "@tanstack/react-start/server";
import { env } from "@/config/env";
import { storefrontOpen } from "@/core/storefront/access";
import { canonicalOrigin, shareOrigin, storeCover } from "@/core/storefront/share.server";
import { shopManifest } from "@/core/storefront/share";
import { shopIconPng } from "@/core/storefront/icon.server";
import { getSettings } from "@/core/settings/settings";
import type { Tenant } from "@/core/tenant/types";
import { PRODUCT_SELECT, type Product } from "@/core/catalog/catalog";
import { listAllCategories } from "@/core/catalog/admin";
import { visibleCategoryIds } from "@/core/storefront/categories";
import { listedOnStorefront } from "@/core/storefront/sitemap";

/**
 * Превью ссылок и установка витрины на телефон (core/storefront/share).
 * Клиент прежней платформы, архив, витрина без модуля — «не найден»
 * (storefrontOpen), как у страниц витрины и карты сайта.
 */

/**
 * «info» открыт и без каталога (например, только юр. страницы) — теги превью
 * такой странице нужны; «catalog» — есть витрина, её можно установить.
 */
async function openShop(slug: string, part: "info" | "catalog"): Promise<Tenant | null> {
  const { resolveTenant } = await import("@/core/tenant/resolve.server");
  const t = await resolveTenant({ by: "slug", value: slug.toLowerCase() });
  return t && t.settings.slug && storefrontOpen(t, part) ? t : null;
}

/** Адрес для абсолютных ссылок и картинка витрины — для тегов страницы. */
export async function shareInfo(slug: string): Promise<{
  origin: string;
  /** Адрес для canonical: свой домен магазина или адрес платформы. */
  canonical: string;
  cover: string | null;
  installable: boolean;
} | null> {
  const t = await openShop(slug, "info");
  if (!t) return null;
  const { tenantContext } = await import("@/core/tenant/resolve.server");
  return {
    origin: shareOrigin(t, getRequestUrl().toString(), env().APP_URL),
    canonical: canonicalOrigin(t, env().APP_URL),
    cover: await storeCover(tenantContext(t)),
    installable: storefrontOpen(t, "catalog"),
  };
}

/**
 * Для разметки товара в поиске: виден ли товар в каталоге витрины (как в
 * карте сайта) и оценка из одобренных отзывов. Скрытый, снятый с продажи
 * или цифровой без файлов — listed: false, разметки нет.
 */
export async function productSeo(
  slug: string,
  id: string,
): Promise<{ listed: boolean; rating: { avg: number; count: number } | null } | null> {
  const t = await openShop(slug, "catalog");
  if (!t) return null;
  const { tenantContext } = await import("@/core/tenant/resolve.server");
  const ctx = tenantContext(t);
  const [{ data, error }, cats] = await Promise.all([
    ctx.db.from("products").select(PRODUCT_SELECT).eq("id", id).maybeSingle(),
    listAllCategories(ctx),
  ]);
  if (error) throw new Error(error.message);
  const known = new Set(cats.map((c) => c.id));
  if (!data || !listedOnStorefront(data as Product, known, visibleCategoryIds(cats)))
    return { listed: false, rating: null };
  const { approvedRating } = await import("@/core/reviews/photos.server");
  return { listed: true, rating: await approvedRating(ctx, id) };
}

const TEXT = { "content-type": "text/plain; charset=utf-8" };
const notFound = () => new Response("not found", { status: 404, headers: TEXT });

/** Размеры иконок: 180 — iPhone, 192 и 512 — Android и манифест. */
const SIZES = new Set([180, 192, 512]);

/** /s/<slug>/manifest.webmanifest */
export async function manifestResponse(slug: string): Promise<Response> {
  const t = await openShop(slug, "catalog");
  if (!t) return notFound();
  const { tenantContext } = await import("@/core/tenant/resolve.server");
  const s = await getSettings(tenantContext(t), ["shop_name", "shop_tagline", "storefront_accent"]);
  const accent = /^#[0-9a-f]{6}$/i.test(s.storefront_accent ?? "") ? s.storefront_accent! : null;
  const body = shopManifest({
    slug: t.settings.slug!,
    name: s.shop_name?.trim() || t.name,
    tagline: s.shop_tagline ?? null,
    accent,
  });
  return new Response(JSON.stringify(body), {
    headers: {
      "content-type": "application/manifest+json; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });
}

/** /s/<slug>/icon/<размер> — PNG в цвете магазина. */
export async function iconResponse(slug: string, rawSize: string): Promise<Response> {
  const size = Number(rawSize);
  if (!/^\d{3}$/.test(rawSize) || !SIZES.has(size)) return notFound();
  const t = await openShop(slug, "catalog");
  if (!t) return notFound();
  const { tenantContext } = await import("@/core/tenant/resolve.server");
  const s = await getSettings(tenantContext(t), ["storefront_accent"]);
  return new Response(new Uint8Array(shopIconPng(size, s.storefront_accent ?? null)), {
    headers: { "content-type": "image/png", "cache-control": "public, max-age=86400" },
  });
}
