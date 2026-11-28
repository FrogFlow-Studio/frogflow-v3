import { SHOP_SLUG_RE } from "@/core/tenant/slug";
import { notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { shownError } from "@/lib/shown-error";
import type { Locale } from "@/core/i18n/locale";
import { payLane } from "@/v4/core/served-by";

/**
 * Покупка внутри Mini App для магазина на v4. Покупатель подписан initData.
 * Код предложения забирает цену на 72 часа; без кода окно само держит цену.
 * Повтор того же ключа не создаёт второй заказ.
 */

const slug = z.string().regex(SHOP_SLUG_RE);
const OFFER = /^[A-HJ-NP-Z2-9]{8}$/;
const SCHEMA = /schema must be one of|PGRST106/i;

const item = z.object({
  product_id: z.string().uuid(),
  product_variant_id: z.string().uuid().nullable().optional(),
  quantity: z.number().int().min(1).max(5),
});

async function shopT(ctx: { tenant: { settings: { default_locale?: Locale } } }) {
  const { storefrontT } = await import("@/app/i18n/storefront");
  return storefrontT(ctx.tenant.settings.default_locale ?? "ru");
}

async function miniCtx(s: string) {
  const { resolveTenant, tenantContext } = await import("@/core/tenant/resolve.server");
  const { storefrontOpen } = await import("@/core/storefront/access");
  const t = await resolveTenant({ by: "slug", value: s });
  if (!t || !storefrontOpen(t, "mini_app")) throw notFound();
  return tenantContext(t);
}

function productIds(
  items: Array<{ product_id: string; product_variant_id?: string | null; quantity: number }>,
): string[] {
  const ids: string[] = [];
  for (const it of items) {
    const id = it.product_variant_id || it.product_id;
    for (let i = 0; i < it.quantity; i++) ids.push(id);
  }
  return ids;
}

async function signedUser(ctx: Awaited<ReturnType<typeof miniCtx>>, initData: string) {
  const t = await shopT(ctx);
  const { validateInitData } = await import("@/core/storefront/init-data");
  const v = validateInitData(initData, ctx.secrets.telegramToken());
  if (!v.ok)
    throw shownError(t(v.reason === "expired" ? "error.miniAppExpired" : "error.miniAppAuth"));
  const { takeMiniApp } = await import("@/core/storefront/rate-limit");
  if (!(await takeMiniApp(ctx, v.user.id, "checkout")))
    throw shownError(t("error.tooManyRequests"));
  return { t, user: v.user };
}

async function v4(ctx: Awaited<ReturnType<typeof miniCtx>>) {
  const { tenantDb } = await import("@/core/db/client.server");
  const { postgrestV4Db } = await import("@/v4/core/db");
  return postgrestV4Db(tenantDb(ctx.tenant.id) as unknown as Parameters<typeof postgrestV4Db>[0]);
}

/** Куда пишет заказ витрины. Магазин не на v4 остаётся на прежнем пути. */
export const shopPayLaneFn = createServerFn({ method: "GET" })
  .validator((d: unknown) => z.object({ slug }).parse(d))
  .handler(async ({ data }) => {
    const { resolveTenant } = await import("@/core/tenant/resolve.server");
    const t = await resolveTenant({ by: "slug", value: data.slug });
    return { lane: payLane(t?.settings.served_by) };
  });

/** Цена предложения для этого товара. Нет кода или он чужой — обычная цена страницы. */
export const storeOfferPeekFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        slug,
        initData: z.string().min(1).max(8000),
        offer: z.string().regex(OFFER),
        productId: z.string().uuid(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await miniCtx(data.slug);
    if (payLane(ctx.tenant.settings.served_by) !== "v4") return { state: "none" as const };
    const { validateInitData } = await import("@/core/storefront/init-data");
    const v = validateInitData(data.initData, ctx.secrets.telegramToken());
    if (!v.ok) return { state: "none" as const };
    const { takeMiniApp } = await import("@/core/storefront/rate-limit");
    if (!(await takeMiniApp(ctx, v.user.id, "orders"))) return { state: "none" as const };
    try {
      const { peekOffer } = await import("@/v4/seller/offers");
      const { touchBuyer } = await import("@/v4/core/platform");
      const db = await v4(ctx);
      const buyerId = await touchBuyer(db, {
        botId: ctx.tenant.id,
        channel: "telegram",
        externalId: String(v.user.id),
        country: null,
      });
      const seen = await peekOffer(db, {
        botId: ctx.tenant.id,
        buyerId,
        offerId: data.offer.toUpperCase(),
      });
      if (!seen.ok) {
        if (seen.reason === "expired") return { state: "expired" as const };
        if (seen.reason === "price_changed") return { state: "changed" as const };
        return { state: "none" as const };
      }
      const i = seen.productIds.indexOf(data.productId);
      if (i < 0 || seen.state !== "open") return { state: "none" as const };
      return {
        state: "open" as const,
        amountMajor: seen.pricesMinor[i]! / 100,
        currency: seen.currency,
      };
    } catch (e) {
      if (e instanceof Error && SCHEMA.test(e.message)) return { state: "none" as const };
      throw e;
    }
  });

/** Оформить корзину Mini App в книгу v4. */
export const shopOrderFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        slug,
        initData: z.string().min(1).max(8000),
        items: z.array(item).min(1).max(10),
        claimId: z.string().min(8).max(80),
        offer: z.string().regex(OFFER).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await miniCtx(data.slug);
    const { t, user } = await signedUser(ctx, data.initData);
    if (payLane(ctx.tenant.settings.served_by) !== "v4")
      throw shownError(t("error.orderUnavailable"));
    const ids = productIds(data.items);
    if (ids.length > 10) throw shownError(t("error.orderUnavailable"));
    try {
      const { buyInShop } = await import("@/v4/channels/shop-window");
      const bought = await buyInShop(await v4(ctx), {
        botId: ctx.tenant.id,
        telegramId: String(user.id),
        country: null,
        productIds: ids,
        claimId: data.claimId,
        ...(data.offer ? { offerId: data.offer.toUpperCase() } : {}),
      });
      if (!bought.ok) {
        if (bought.code === "duplicate") throw shownError(t("product.orderDuplicate"));
        if (bought.code === "expired") throw shownError(t("product.offerExpired"));
        if (bought.code === "price_changed") throw shownError(t("product.offerChanged"));
        throw shownError(t("error.orderUnavailable"));
      }
      return { no: bought.no, reused: bought.reused };
    } catch (e) {
      if (e instanceof Error && SCHEMA.test(e.message))
        throw shownError(t("error.orderUnavailable"));
      throw e;
    }
  });
