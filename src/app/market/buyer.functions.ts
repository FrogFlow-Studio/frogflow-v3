import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { Locale } from "@/core/i18n/locale";

/** Магазинов на странице «Мои заказы»; остальные считаются и показываются числом. */
export const ACCOUNT_SHOPS_MAX = 12;
const ORDERS_PER_SHOP = 5;

const input = z.object({ lang: z.enum(["ru", "kk", "en", "uz"]).optional().catch(undefined) });

export type AccountShop = {
  name: string;
  slug: string;
  orders: { no: number; status: string; total: number; currency: string; at: string }[];
};

/**
 * «Мои заказы во всех магазинах» (В17). Человек определяется подписанной cookie площадки,
 * которую выдаёт только подтверждённый вход в магазин. Заказы читаются у каждого магазина под
 * его ролью арендатора и только по профилю, привязанному к этому человеку; баллы и чужие
 * данные не отдаются. Таблиц нет — `ready: false`, вход по магазину работает как раньше.
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
      const { servedByV2 } = await import("@/core/tenant/directory");
      const byId = new Map((await tenantDirectory()).map((t) => [t.id, t]));
      // Только магазины на v2 и не в архиве: клиент прежней платформы для v2 невидим.
      const open = links.filter((l) => {
        const t = byId.get(l.botId);
        return t && !t.archived && servedByV2(t) && t.settings.slug;
      });
      const { getCustomer } = await import("@/core/customers/customers");
      const { listCustomerOrders } = await import("@/core/orders/orders");
      const { displayNo } = await import("@/core/orders/pure");
      const { storefrontT } = await import("@/app/i18n/storefront");
      const t = storefrontT((data.lang ?? "ru") as Locale);
      const shops: AccountShop[] = [];
      for (const l of open.slice(0, ACCOUNT_SHOPS_MAX)) {
        const tenant = byId.get(l.botId)!;
        const ctx = tenantContext(tenant);
        const customer = await getCustomer(ctx, l.userKey);
        const rows = customer ? await listCustomerOrders(ctx, customer, ORDERS_PER_SHOP) : [];
        shops.push({
          name: tenant.name,
          slug: tenant.settings.slug!,
          orders: rows.map((o) => {
            const key = `orders.status.${o.status}` as Parameters<typeof t>[0];
            const label = t(key);
            return {
              no: displayNo(o),
              status: label === key ? o.status : label,
              total: Number(o.total),
              currency: o.currency,
              at: o.created_at,
            };
          }),
        });
      }
      return {
        ready: true as const,
        signedIn: true as const,
        shops,
        moreShops: Math.max(0, open.length - ACCOUNT_SHOPS_MAX),
      };
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
