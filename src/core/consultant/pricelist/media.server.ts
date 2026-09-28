import type { TenantContext } from "@/core/tenant/resolve.server";
import { getSettings, setSetting } from "@/core/settings/settings";
import { imagePath } from "@/core/catalog/image-url";
import { parseProductMedia, PRODUCT_MEDIA_KEY, type ProductMedia } from "./media";

/** Фотобаза консультанта по прайсу — та же строка app_settings, что пишет v1. */
export async function loadProductMedia(ctx: TenantContext): Promise<ProductMedia[]> {
  const s = await getSettings(ctx, [PRODUCT_MEDIA_KEY]);
  return parseProductMedia(s[PRODUCT_MEDIA_KEY]);
}

export async function saveProductMedia(ctx: TenantContext, list: ProductMedia[]): Promise<void> {
  await setSetting(ctx, PRODUCT_MEDIA_KEY, JSON.stringify(list));
}

/**
 * Публичная ссылка на файл: её скачивают Instagram и Telegram. Путь в бакете
 * под префиксом bot_id — отдаёт /api/img/<bot_id> (только клиентам на v2).
 */
export function productMediaUrl(ctx: TenantContext, path: string): string {
  return `${ctx.appUrl.replace(/\/+$/, "")}${imagePath(ctx.tenant.id, path)}`;
}
