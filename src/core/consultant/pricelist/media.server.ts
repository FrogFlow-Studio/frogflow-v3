import type { TenantContext } from "@/core/tenant/resolve.server";
import { getSettings, getSettingStrict, updateSettingStamped } from "@/core/settings/settings";
import { serverFailure } from "@/lib/server-failure";
import { imagePath } from "@/core/catalog/image-url";
import { isTenantStorageKey } from "@/core/storage/keys";
import { parseProductMedia, PRODUCT_MEDIA_KEY, type ProductMedia } from "./media";
import { serviceDb } from "@/core/db/client.server";

const ZERNIO_MEDIA_URL_TTL_SEC = 15 * 60;

/**
 * Фотобаза консультанта по прайсу — та же строка app_settings, что пишет v1.
 * Мягкое чтение — для ответа покупателю: сбой базы значит «без фото», а не
 * сорванный ответ. Админка читает строго (loadProductMediaStrict).
 */
export async function loadProductMedia(ctx: TenantContext): Promise<ProductMedia[]> {
  const s = await getSettings(ctx, [PRODUCT_MEDIA_KEY]);
  return parseProductMedia(s[PRODUCT_MEDIA_KEY]);
}

/** Строгое чтение: «не удалось прочитать» — сбой, а не пустая фотобаза. */
export async function loadProductMediaStrict(ctx: TenantContext): Promise<ProductMedia[]> {
  return parseProductMedia(await getSettingStrict(ctx, PRODUCT_MEDIA_KEY));
}

/**
 * Изменить фотобазу: чтение и запись одним условным обновлением по метке
 * updated_at (updateSettingStamped). Прежде список читался мягко, и один сбой
 * чтения при загрузке фото записывал вместо всей фотобазы одно новое фото;
 * две загрузки сразу теряли одну. Теперь сбой чтения — ошибка без записи,
 * а проигравший гонку перечитывает список. `change` вернул null — не пишем.
 */
export async function updateProductMedia(
  ctx: TenantContext,
  change: (list: ProductMedia[]) => ProductMedia[] | null,
): Promise<"written" | "skipped"> {
  const outcome = await updateSettingStamped(ctx, PRODUCT_MEDIA_KEY, (raw) => {
    const next = change(parseProductMedia(raw));
    return next ? JSON.stringify(next) : null;
  });
  if (outcome === "failed") throw serverFailure("Фотобаза: изменение не записалось");
  return outcome;
}

/**
 * Публичная ссылка на файл: её скачивают Instagram и Telegram. Путь в бакете
 * под префиксом bot_id — отдаёт /api/img/<bot_id> (только клиентам на v2).
 */
export function productMediaUrl(ctx: TenantContext, path: string): string {
  return `${ctx.appUrl.replace(/\/+$/, "")}${imagePath(ctx.tenant.id, path)}`;
}

/**
 * Zernio скачивает attachmentUrl своими серверами. Даём ему прямую короткую
 * Storage-ссылку на байты, чтобы отправка не зависела от домена магазина,
 * редиректов или HTML от промежуточной страницы.
 */
export async function productMediaAttachmentUrl(ctx: TenantContext, path: string): Promise<string> {
  const key = path.startsWith(`${ctx.tenant.id}/`) ? path : `${ctx.tenant.id}/${path}`;
  if (isTenantStorageKey(ctx.tenant.id, key)) {
    try {
      const { data, error } = await serviceDb()
        .storage.from("product-images")
        .createSignedUrl(key, ZERNIO_MEDIA_URL_TTL_SEC);
      if (!error && data?.signedUrl) return data.signedUrl;
      console.warn(
        `[consultant-media:${ctx.tenant.id}] signed URL unavailable; using public proxy`,
      );
    } catch (error) {
      console.warn(
        `[consultant-media:${ctx.tenant.id}] signed URL unavailable; using public proxy: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return productMediaUrl(ctx, path);
}
