import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Locale } from "@/core/i18n/locale";
import { BUY_BUTTON_TITLE, buyButtonPayload, findOfferVariant } from "./buy-button";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Сколько знаков названия берёт текст напоминания: Instagram режет длиннее 640. */
const NAME_MAX = 120;

export type BuyOfferButton = {
  button: { type: "postback"; title: string; payload: string };
  /** Товар и выбранный вариант — для текста напоминания. */
  name: string;
  /** Фото товара по порядку — для карточки над кнопкой (настройка buy_button_photo). */
  imagePaths: string[];
};

/**
 * Кнопка для товара из offer_buy_button: товар в продаже, у товара с
 * вариантами — выбранный действующий вариант (по id или названию). Иначе null: ответ уходит без
 * кнопки, напоминание не уходит. Сбой чтения каталога бросает — вызывающий
 * решает, что делать (ответ без кнопки, напоминание в следующий прогон).
 */
export async function buyOfferButton(
  ctx: TenantContext,
  offer: { productId: string; variantId?: string },
  locale: Locale,
): Promise<BuyOfferButton | null> {
  if (!UUID.test(offer.productId)) return null;
  const { getProduct, sortedImages, sortedVariants } = await import("@/core/catalog/catalog");
  const product = await getProduct(ctx, offer.productId);
  if (!product) return null;
  const variants = sortedVariants(product);
  const variant = findOfferVariant(variants, offer.variantId);
  if (variants.length && !variant) return null;
  const name = (variant?.name ? `${product.name} — ${variant.name}` : product.name).trim();
  return {
    button: {
      type: "postback",
      title: BUY_BUTTON_TITLE[locale],
      payload: buyButtonPayload(product.id, variant ? variant.id : null),
    },
    name: name.length > NAME_MAX ? `${name.slice(0, NAME_MAX - 1).trimEnd()}…` : name,
    imagePaths: sortedImages(product).map((i) => i.image_path),
  };
}
