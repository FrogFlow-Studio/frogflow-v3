import { patchTenantSettings } from "@/core/tenant/resolve.server";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { getSettings } from "@/core/settings/settings";
import { recentApprovedReviews, type RecentReview } from "@/core/reviews/recent.server";
import { parseAbout, type StoreAbout } from "./about";

export const aboutView = (ctx: Pick<TenantContext, "tenant">): StoreAbout =>
  parseAbout(ctx.tenant.settings.storefront_about);

/** Продавец сохраняет «О магазине»; ключи клиента в `bots.settings` не затираются. */
export async function saveAbout(ctx: TenantContext, input: unknown): Promise<StoreAbout> {
  const a = parseAbout(input);
  await patchTenantSettings(ctx.tenant.id, { storefront_about: a });
  return a;
}

export type StoreAboutPage = {
  about: StoreAbout;
  /** Текст «О продавце» из юридических документов — запасное описание. */
  legalAbout: string | null;
  reviews: RecentReview[];
};

/** Данные страницы `/s/<магазин>/about`: свои слова продавца и свежие одобренные отзывы. */
export async function aboutPage(ctx: TenantContext): Promise<StoreAboutPage> {
  const [s, reviews] = await Promise.all([
    getSettings(ctx, ["legal_about"]),
    recentApprovedReviews(ctx, 4),
  ]);
  const legal = ctx.tenant.modules.legal_docs ? s.legal_about?.trim() : "";
  return { about: aboutView(ctx), legalAbout: legal ? legal.slice(0, 1500) : null, reviews };
}
