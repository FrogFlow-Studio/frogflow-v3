import type { TenantContext } from "@/core/tenant/resolve.server";
import { getSetting, setSetting, getSettings } from "@/core/settings/settings";
import type { Locale } from "@/core/i18n/locale";

export type VariantMaterialEntry = {
  filePath: string;
  fileName: string | null;
  language?: Locale;
};

export type VariantMaterialsMap = Record<string, VariantMaterialEntry>;

export const VARIANT_MATERIALS_PREFIX = "variant_materials:";

export function variantMaterialsKey(productId: string): string {
  return `${VARIANT_MATERIALS_PREFIX}${productId}`;
}

export function parseVariantMaterials(raw: string | null | undefined): VariantMaterialsMap {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: VariantMaterialsMap = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (
        v &&
        typeof v === "object" &&
        "filePath" in v &&
        typeof (v as VariantMaterialEntry).filePath === "string"
      ) {
        const item = v as VariantMaterialEntry;
        if (item.filePath.trim()) {
          out[k] = {
            filePath: item.filePath.trim(),
            fileName:
              typeof item.fileName === "string" && item.fileName.trim()
                ? item.fileName.trim()
                : null,
            ...(item.language ? { language: item.language } : {}),
          };
        }
      }
    }
    return out;
  } catch {
    return {};
  }
}

export async function getVariantMaterials(
  ctx: TenantContext,
  productId: string,
): Promise<VariantMaterialsMap> {
  const raw = await getSetting(ctx, variantMaterialsKey(productId));
  return parseVariantMaterials(raw);
}

export async function loadVariantMaterialsForProducts(
  ctx: TenantContext,
  productIds: string[],
): Promise<Map<string, VariantMaterialsMap>> {
  const out = new Map<string, VariantMaterialsMap>();
  if (productIds.length === 0) return out;
  const uniqueIds = [...new Set(productIds)];
  const keys = uniqueIds.map(variantMaterialsKey);
  const settings = await getSettings(ctx, keys);
  for (const pid of uniqueIds) {
    const raw = settings[variantMaterialsKey(pid)];
    if (raw) {
      const parsed = parseVariantMaterials(raw);
      if (Object.keys(parsed).length > 0) out.set(pid, parsed);
    }
  }
  return out;
}

export async function saveVariantMaterials(
  ctx: TenantContext,
  productId: string,
  map: VariantMaterialsMap,
): Promise<void> {
  const clean: VariantMaterialsMap = {};
  for (const [k, v] of Object.entries(map)) {
    if (v?.filePath?.trim()) {
      clean[k] = {
        filePath: v.filePath.trim(),
        fileName: v.fileName?.trim() || null,
        ...(v.language ? { language: v.language } : {}),
      };
    }
  }
  await setSetting(ctx, variantMaterialsKey(productId), JSON.stringify(clean));
}

export function resolveVariantMaterial(
  map: VariantMaterialsMap,
  variantId?: string | null,
  variantName?: string | null,
): VariantMaterialEntry | null {
  if (!map || Object.keys(map).length === 0) return null;
  if (variantId && map[variantId]) return map[variantId]!;
  if (variantName) {
    const trimmed = variantName.trim();
    if (map[trimmed]) return map[trimmed]!;
    const lower = trimmed.toLowerCase();
    for (const [k, v] of Object.entries(map)) {
      if (k.trim().toLowerCase() === lower) return v;
    }
  }
  return null;
}

export async function copyVariantMaterials(
  ctx: TenantContext,
  oldProductId: string,
  newProductId: string,
  variantIdMap?: ReadonlyMap<string, string>,
): Promise<void> {
  const prev = await getVariantMaterials(ctx, oldProductId);
  if (Object.keys(prev).length === 0) return;
  const next: VariantMaterialsMap = {};
  for (const [k, v] of Object.entries(prev)) {
    const newId = variantIdMap?.get(k) ?? k;
    next[newId] = v;
  }
  await saveVariantMaterials(ctx, newProductId, next);
}
