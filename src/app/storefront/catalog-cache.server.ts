import type { storeCatalogPage } from "@/core/storefront/catalog";
import { CATALOG_TTL_MS, createTtlCache } from "@/core/storefront/ttl-cache";

/** Минутный кеш страниц каталога (storeCatalogPageFn). */
export const catalogCache =
  createTtlCache<Awaited<ReturnType<typeof storeCatalogPage>>>(CATALOG_TTL_MS);
