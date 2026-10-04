import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { Locale } from "@/core/i18n/locale";

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
      return { ready: true as const, signedIn: true as const, ...account };
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
