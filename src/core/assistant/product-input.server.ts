import { mediaTypeOf } from "@/core/social/post-draft";
import { isTenantStorageKey } from "@/core/storage/keys";
import { UserError } from "@/core/i18n/user-error";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { AssistProduct } from "./prompts";
import { serverFailure } from "@/lib/server-failure";

/**
 * Товар для черновика поста: поля карточки и первое фото, которое можно
 * сразу приложить к посту (ключ под префиксом клиента, JPEG или PNG —
 * другие Instagram через Zernio не принимает).
 */
export async function productForPost(
  ctx: TenantContext,
  id: string,
): Promise<{ product: AssistProduct; image: string | null }> {
  const { data, error } = await ctx.db
    .from("products")
    .select(
      "name, description, keywords, price, currency, fulfillment_kind, product_images(image_path, sort_order)",
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw serverFailure(`Товар для ИИ-помощника: ${error.message}`);
  if (!data) throw new UserError("err.assist.noProduct", "Товар не найден.");
  const image =
    (data.product_images ?? [])
      .slice()
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((i) => i.image_path)
      .find((k) => isTenantStorageKey(ctx.tenant.id, k) && mediaTypeOf(k) === "image") ?? null;
  return {
    product: {
      name: data.name,
      description: data.description,
      keywords: data.keywords,
      price: Number(data.price) || null,
      currency: data.currency,
      kind: data.fulfillment_kind === "physical" ? "physical" : "digital",
    },
    image,
  };
}
