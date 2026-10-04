import type { TenantContext } from "@/core/tenant/resolve.server";
import { imageUrl } from "@/core/catalog/catalog";
import type { OrderWithItems } from "@/core/orders/orders";
import { proofSignedUrl } from "@/core/orders/admin";
import type { Locale } from "@/core/i18n/locale";

/** Подписи медиа в уведомлении продавцу о заказе — на языке магазина. */
const CAPTIONS: Record<Locale, { proof: (no: string | number) => string }> = {
  ru: { proof: (no) => `🧾 Чек оплаты — заказ #${no}` },
  kk: { proof: (no) => `🧾 Төлем чегі — #${no} тапсырыс` },
  en: { proof: (no) => `🧾 Payment receipt — order #${no}` },
  uz: { proof: (no) => `🧾 To‘lov cheki — #${no} buyurtma` },
};

export function proofCaption(locale: string | undefined, no: string | number): string {
  return (CAPTIONS[(locale as Locale) ?? "ru"] ?? CAPTIONS.ru).proof(no);
}

const MAX_ALBUM = 10;
const IN_CHUNK = 200;

/**
 * Фото товаров заказа для альбома: первая картинка каждого товара, по порядку
 * позиций, без повторов, не больше десяти. Не прочиталось — пустой список:
 * уведомление уходит и без фото.
 */
export async function orderPhotoUrls(ctx: TenantContext, order: OrderWithItems): Promise<string[]> {
  const ids = [
    ...new Set((order.order_items ?? []).map((i) => i.product_id).filter((x): x is string => !!x)),
  ];
  if (ids.length === 0) return [];
  const first = new Map<string, string>();
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const { data, error } = await ctx.db
      .from("product_images")
      .select("id, product_id, image_path, sort_order")
      .in("product_id", ids.slice(i, i + IN_CHUNK))
      .order("sort_order", { ascending: true })
      .order("id", { ascending: true });
    if (error) {
      console.warn(`[tg:${ctx.tenant.id}] фото заказа #${order.id} не прочитаны: ${error.message}`);
      return [];
    }
    for (const r of data ?? []) if (!first.has(r.product_id)) first.set(r.product_id, r.image_path);
  }
  const urls: string[] = [];
  for (const it of order.order_items ?? []) {
    const path = it.product_id ? first.get(it.product_id) : undefined;
    if (!path) continue;
    const url = imageUrl(ctx, path);
    if (!urls.includes(url)) urls.push(url);
    if (urls.length === MAX_ALBUM) break;
  }
  return urls;
}

export type StoredProof = { url: string; kind: "photo" | "document" };

/** Чек, лежащий у нас в хранилище (Instagram, WhatsApp, витрина): свежая ссылка для Telegram. */
export async function storedProof(
  ctx: TenantContext,
  order: OrderWithItems,
): Promise<StoredProof | null> {
  const path = order.payment_proof_path;
  if (!path) return null;
  const url = await proofSignedUrl(ctx, path).catch(() => null);
  if (!url) return null;
  return { url, kind: /\.(jpe?g|png|webp)$/i.test(path) ? "photo" : "document" };
}
