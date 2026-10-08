import type { TenantContext } from "@/core/tenant/resolve.server";
import { getSettingsStrict, setSetting } from "@/core/settings/settings";
import {
  isHiddenProduct,
  sellableProducts,
  withoutDemoMarking,
  type ConsultantProduct,
} from "./catalog";
import { parseSynonymGroups } from "./synonyms";

/**
 * Прайс консультанта BOVI из базы (перенос чтения src/lib/consultant/catalog.ts
 * v1): те же строки app_settings, что пишет v1, — `consultant_catalog_json`,
 * `consultant_catalog_meta`, `consultant_synonyms`, `consultant_shop_url`.
 * Кэш на 45 с — по арендатору: в v1 он был общим на процесс, у v2 процесс
 * один на всех клиентов.
 *
 * Чтение строгое: сбой базы — ошибка, а не пустой прайс. Иначе покупатель
 * слышит «такого нет», а пустой снимок ещё 45 с лежит в кэше.
 */
export const CATALOG_KEY = "consultant_catalog_json";
export const CATALOG_META_KEY = "consultant_catalog_meta";
export const SYNONYMS_KEY = "consultant_synonyms";
export const SHOP_URL_KEY = "consultant_shop_url";
export const DEFAULT_SHOP_URL = "https://bovi.kz";
const CACHE_MS = 45_000;

export type CatalogMeta = { count: number; importedAt: string; source: string };

export type PricelistSnapshot = {
  /** Что консультант может показывать. */
  products: ConsultantProduct[];
  /** Снятое с производства: продавцу в админке видно, покупателю — нет. */
  hidden: ConsultantProduct[];
  /** Синонимы продавца — для withSynonyms при поиске. */
  synonyms: string[][];
  synonymsText: string;
  meta: CatalogMeta | null;
  shopUrl: string;
};

const cache = new Map<string, { at: number; snap: PricelistSnapshot }>();

export function isConsultantProduct(row: unknown): row is ConsultantProduct {
  if (!row || typeof row !== "object") return false;
  const p = row as Partial<ConsultantProduct>;
  return (
    typeof p.id === "string" &&
    typeof p.name === "string" &&
    typeof p.category === "string" &&
    typeof p.size === "string" &&
    Array.isArray(p.colors) &&
    typeof p.price_kzt === "number" &&
    typeof p.stock === "boolean"
  );
}

/** Прайс из строки JSON: видимое без пометки «демо», снятое — отдельно, как в v1. */
export function snapshotOf(
  raw: string | null | undefined,
): Pick<PricelistSnapshot, "products" | "hidden"> {
  let rows: ConsultantProduct[] = [];
  try {
    const parsed = JSON.parse(raw?.trim() || "[]") as unknown;
    if (Array.isArray(parsed)) rows = parsed.filter(isConsultantProduct);
  } catch {
    rows = [];
  }
  const hidden = rows.filter(isHiddenProduct);
  const visible = hidden.length > 0 ? sellableProducts(rows) : rows;
  // Пометка «демонстрационный» снимается только с того, что увидит покупатель.
  return { products: visible.map(withoutDemoMarking), hidden };
}

function metaOf(raw: string | undefined): CatalogMeta | null {
  try {
    const m = JSON.parse(raw ?? "") as CatalogMeta;
    return m && typeof m.count === "number" ? m : null;
  } catch {
    return null;
  }
}

export async function loadPricelist(
  ctx: TenantContext,
  now = Date.now(),
): Promise<PricelistSnapshot> {
  const hit = cache.get(ctx.tenant.id);
  if (hit && now - hit.at < CACHE_MS) return hit.snap;
  const s = await getSettingsStrict(ctx, [
    CATALOG_KEY,
    CATALOG_META_KEY,
    SYNONYMS_KEY,
    SHOP_URL_KEY,
  ]);
  const synonymsText = s[SYNONYMS_KEY] ?? "";
  const snap: PricelistSnapshot = {
    ...snapshotOf(s[CATALOG_KEY]),
    synonyms: parseSynonymGroups(synonymsText),
    synonymsText,
    meta: metaOf(s[CATALOG_META_KEY]),
    shopUrl: s[SHOP_URL_KEY]?.trim() || DEFAULT_SHOP_URL,
  };
  cache.set(ctx.tenant.id, { at: now, snap });
  return snap;
}

export function invalidatePricelist(ctx: TenantContext): void {
  cache.delete(ctx.tenant.id);
}

/** Новый прайс (загрузка 1С в админке): снимок и сводка, кэш магазина сбрасывается. */
export async function savePricelist(
  ctx: TenantContext,
  products: ConsultantProduct[],
  source: string,
  now = new Date(),
): Promise<CatalogMeta> {
  const meta: CatalogMeta = { count: products.length, importedAt: now.toISOString(), source };
  await setSetting(ctx, CATALOG_KEY, JSON.stringify(products));
  await setSetting(ctx, CATALOG_META_KEY, JSON.stringify(meta));
  invalidatePricelist(ctx);
  return meta;
}

export async function saveSynonyms(ctx: TenantContext, text: string): Promise<string[][]> {
  const groups = parseSynonymGroups(text);
  await setSetting(ctx, SYNONYMS_KEY, groups.map((g) => g.join(", ")).join("\n"));
  invalidatePricelist(ctx);
  return groups;
}
