import { serverFailure } from "@/lib/server-failure";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { getProduct, PRODUCT_SELECT, searchProducts, type Product } from "@/core/catalog/catalog";
import { getSetting } from "@/core/settings/settings";
import { sellsNowOrShop } from "@/core/tenant/sells.server";
import { SUPPORTED_LOCALES, type Locale } from "@/core/i18n/locale";
import { COPY } from "@/channels/telegram/copy";
import {
  languageChoice,
  mainMenu,
  productCard,
  welcomeHtml,
  type MainMenu,
  type ProductCard,
} from "@/channels/telegram/screens";
import type { InlineButton } from "@/channels/telegram/types";

/**
 * Предпросмотр бота в админке: те же экраны, что бот шлёт покупателю
 * (channels/telegram/screens), но без отправки в Telegram и без записи в
 * базу. Цена — как у покупателя без выбранной страны.
 */
export type BotPreview = {
  locale: Locale;
  /** Языки, которые покупатель может выбрать; один — выбора нет. */
  locales: Locale[];
  /** Вопрос о языке по /start (модуль multi_language), иначе null. */
  languageChoice: { text: string; buttons: InlineButton[][] } | null;
  welcome: string;
  menu: MainMenu;
  product: (ProductCard & { id: string; name: string }) | null;
};

async function firstProduct(ctx: TenantContext): Promise<Product | null> {
  const { data, error: dataError } = await ctx.db
    .from("products")
    .select(PRODUCT_SELECT)
    .eq("is_active", true)
    .order("sort_order")
    .order("id")
    .limit(1);
  if (dataError) throw serverFailure(`Предпросмотр бота: ${dataError.message}`);
  return ((data ?? [])[0] as Product | undefined) ?? null;
}

export async function botPreview(
  ctx: TenantContext,
  opts: { locale?: Locale; productId?: string },
): Promise<BotPreview> {
  const t = ctx.tenant;
  const fallback = t.settings.default_locale ?? "ru";
  const locales = t.modules.multi_language ? [...SUPPORTED_LOCALES] : [fallback];
  const locale = opts.locale && locales.includes(opts.locale) ? opts.locale : fallback;
  const shopName = (await getSetting(ctx, "shop_name")) ?? t.name;
  const p = opts.productId ? await getProduct(ctx, opts.productId) : await firstProduct(ctx);
  return {
    locale,
    locales,
    languageChoice: t.modules.multi_language
      ? { text: COPY[fallback].chooseLanguage, buttons: languageChoice() }
      : null,
    welcome: welcomeHtml(t, shopName, locale),
    // Консультант без товаров (BOVI): меню без каталога и корзины, как в боте.
    menu: mainMenu(t, locale, ctx.appUrl, await sellsNowOrShop(ctx)),
    product: p ? { id: p.id, name: p.name, ...(await productCard(ctx, p, locale, null)) } : null,
  };
}

/** Товары для выбора в предпросмотре — тот же поиск, что у бота. */
export async function botPreviewProducts(
  ctx: TenantContext,
  q: string,
): Promise<Array<{ id: string; name: string }>> {
  return (await searchProducts(ctx, q, 10)).map((p) => ({ id: p.id, name: p.name }));
}
