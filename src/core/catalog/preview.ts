import type { TenantContext } from "@/core/tenant/resolve.server";
import { getSetting, setSetting } from "@/core/settings/settings";
import { isTenantStorageKey } from "@/core/storage/keys";

/**
 * Пример цифрового товара: до 5 картинок (страницы методички, обложки
 * уроков) — покупатель видит их до покупки на витрине и по кнопке в боте.
 * Своей колонки нет: список ключей в бакете товаров — строка app_settings
 * `product_preview:<id товара>`. Картинки публичные, как фото товара.
 */
export const PREVIEW_PREFIX = "product_preview:";
export const MAX_PREVIEW = 5;

export function parsePreview(raw: string | null | undefined, tenantId: string): string[] {
  try {
    const v = JSON.parse(raw ?? "[]") as unknown;
    return Array.isArray(v)
      ? v
          .filter((k): k is string => typeof k === "string" && isTenantStorageKey(tenantId, k))
          .slice(0, MAX_PREVIEW)
      : [];
  } catch {
    return [];
  }
}

export async function loadPreview(ctx: TenantContext, productId: string): Promise<string[]> {
  return parsePreview(await getSetting(ctx, `${PREVIEW_PREFIX}${productId}`), ctx.tenant.id);
}

/** Сохранить пример; чужие ключи отбрасываются, лишние сверх пяти — тоже. */
export async function savePreview(
  ctx: TenantContext,
  productId: string,
  keys: string[],
): Promise<string[]> {
  const clean = parsePreview(JSON.stringify(keys), ctx.tenant.id);
  await setSetting(ctx, `${PREVIEW_PREFIX}${productId}`, JSON.stringify(clean));
  return clean;
}
