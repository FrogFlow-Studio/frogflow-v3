import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { Locale } from "@/core/i18n/locale";
import type { FavoritesList } from "@/core/marketplace/favorites.server";

const input = z.object({ lang: z.enum(["ru", "kk", "en", "uz"]).optional().catch(undefined) });

/**
 * «Мои заказы во всех магазинах» (В17, Ш2): заказы, избранное и адреса из заказов. Человек определяется подписанной cookie площадки,
 * которую выдаёт только подтверждённый вход в магазин. Заказы читаются у каждого магазина под
 * его ролью арендатора и только по профилю, привязанному к этому человеку (core/marketplace/account.server);
 * баллы и чужие данные не отдаются. Таблиц нет — `ready: false`, вход по магазину работает как раньше.
 */
export const marketAccountFn = createServerFn({ method: "GET" })
  .validator((d: unknown) => input.parse(d ?? {}))
  .handler(async ({ data }) => {
    const { marketBuyerId } = await import("./buyer.server");
    const { buyerShops, buyersReady } = await import("@/core/marketplace/buyers.server");
    const { MarketplaceNotReady } = await import("@/core/marketplace/not-ready");
    try {
      if (!(await buyersReady())) return { ready: false as const };
      const buyerId = marketBuyerId();
      if (!buyerId) return { ready: true as const, signedIn: false as const };
      const links = await buyerShops(buyerId);
      const { tenantDirectory, tenantContext } = await import("@/core/tenant/resolve.server");
      const { storefrontT } = await import("@/app/i18n/storefront");
      const { buildAccount } = await import("@/core/marketplace/account.server");
      const t = storefrontT((data.lang ?? "ru") as Locale);
      const byId = new Map((await tenantDirectory()).map((x) => [x.id, x]));
      const account = await buildAccount(links, byId, {
        ctxFor: tenantContext,
        statusLabel: (status) => {
          const key = `orders.status.${status}` as Parameters<typeof t>[0];
          const label = t(key);
          return label === key ? status : label;
        },
      });
      // Избранное площадки (К1): таблицы нет — блок «скоро», остальной кабинет работает.
      let favorites: { ready: false } | ({ ready: true } & FavoritesList) = { ready: false };
      try {
        const { listFavorites } = await import("@/core/marketplace/favorites.server");
        favorites = {
          ready: true,
          ...(await listFavorites(buyerId, { tenants: [...byId.values()] })),
        };
      } catch (e) {
        if (!(e instanceof MarketplaceNotReady)) throw e;
      }
      return { ready: true as const, signedIn: true as const, ...account, favorites };
    } catch (e) {
      if (e instanceof MarketplaceNotReady) return { ready: false as const };
      throw e;
    }
  });

/** Выйти с площадки: убирает только cookie площадки, входы в магазины остаются. */
export const marketLogoutFn = createServerFn({ method: "POST" }).handler(async () => {
  const { endMarketSession } = await import("./buyer.server");
  endMarketSession();
  return { ok: true as const };
});

/**
 * Что человек уже отметил (К1): ключи «магазин:товар» для сердечек в поиске. Страница поиска
 * публичная и кэшируется, поэтому сердечки подгружает браузер отдельным запросом по cookie.
 * Без входа или без таблицы — пусто, без ошибки.
 */
export const marketFavoriteKeysFn = createServerFn({ method: "GET" }).handler(async () => {
  const { marketBuyerId } = await import("./buyer.server");
  const { MarketplaceNotReady } = await import("@/core/marketplace/not-ready");
  const buyerId = marketBuyerId();
  if (!buyerId) return { signedIn: false as const, keys: [] as string[] };
  try {
    const { favoriteKeys } = await import("@/core/marketplace/favorites.server");
    return { signedIn: true as const, keys: await favoriteKeys(buyerId) };
  } catch (e) {
    if (e instanceof MarketplaceNotReady) return { signedIn: false as const, keys: [] as string[] };
    throw e;
  }
});

const favInput = z.object({
  shopId: z.string().uuid(),
  productId: z.string().uuid(),
  on: z.boolean(),
});

/** Отметить или снять сердечко (К1). Человек — только из подписанной cookie площадки. */
export const marketFavoriteFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => favInput.parse(d))
  .handler(async ({ data }) => {
    const { marketBuyerId } = await import("./buyer.server");
    const { MarketplaceNotReady } = await import("@/core/marketplace/not-ready");
    const buyerId = marketBuyerId();
    if (!buyerId) return { status: "signin" as const };
    try {
      const { addFavorite, removeFavorite } = await import("@/core/marketplace/favorites.server");
      if (!data.on) return removeFavorite(buyerId, data.shopId, data.productId);
      const { tenantDirectory } = await import("@/core/tenant/resolve.server");
      return await addFavorite(buyerId, data.shopId, data.productId, {
        tenants: await tenantDirectory(),
      });
    } catch (e) {
      if (e instanceof MarketplaceNotReady) return { status: "soon" as const };
      throw e;
    }
  });

/**
 * «Заказать снова» (К3): план по заказу человека в одном из его магазинов. Человек — только из
 * подписанной cookie площадки; магазин и заказ проверяются по его связям (account.server).
 * Чужое или недоступное — `notfound`, без подробностей. Ничего не пишет.
 */
export const marketReorderFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z.object({ slug: z.string().min(1).max(64), orderId: z.number().int().positive() }).parse(d),
  )
  .handler(async ({ data }) => {
    const { marketBuyerId } = await import("./buyer.server");
    const { buyerShops } = await import("@/core/marketplace/buyers.server");
    const { MarketplaceNotReady } = await import("@/core/marketplace/not-ready");
    const buyerId = marketBuyerId();
    if (!buyerId) return { status: "notfound" as const };
    try {
      const links = await buyerShops(buyerId);
      const { tenantDirectory, tenantContext } = await import("@/core/tenant/resolve.server");
      const { reorderFromAccount } = await import("@/core/marketplace/account.server");
      const byId = new Map((await tenantDirectory()).map((x) => [x.id, x]));
      const plan = await reorderFromAccount(links, byId, data.slug, data.orderId, {
        ctxFor: tenantContext,
      });
      return plan ? { status: "ok" as const, plan } : { status: "notfound" as const };
    } catch (e) {
      if (e instanceof MarketplaceNotReady) return { status: "notfound" as const };
      throw e;
    }
  });
