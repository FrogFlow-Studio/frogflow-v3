import { getCustomer } from "@/core/customers/customers";
import { listCustomerOrders } from "@/core/orders/orders";
import { displayNo } from "@/core/orders/pure";
import { parseFavorites } from "@/core/storefront/favorites";
import { storeProductsByIds } from "@/core/storefront/catalog";
import type { ReorderPlan } from "@/core/storefront/reorder";
import { servedByV2 } from "@/core/tenant/directory";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Tenant } from "@/core/tenant/types";
import type { BuyerShop } from "./buyers.server";

/**
 * Страница «Мои заказы» площадки (В17, Ш2): всё, что видно человеку по его привязанным
 * профилям в магазинах. Только чтение, и только по профилям из связей этого человека:
 * чужой профиль сюда не попадает, баллы не читаются. Избранное лежит у покупателя в магазине
 * (`bot_users.state.web_fav`, его пишет вход в магазин), адреса берутся из его же заказов.
 */
export const ACCOUNT_SHOPS_MAX = 12;
export const ORDERS_PER_SHOP = 5;
export const FAVORITES_PER_SHOP = 6;
export const ADDRESSES_MAX = 5;

export type AccountShop = {
  name: string;
  slug: string;
  orders: { id: number; no: number; status: string; total: number; currency: string; at: string }[];
  favorites: { id: string; name: string; price: number; currency: string }[];
  moreFavorites: number;
};

export type Account = {
  shops: AccountShop[];
  moreShops: number;
  addresses: string[];
  moreAddresses: number;
};

type Deps = {
  ctxFor: (t: Tenant) => TenantContext;
  /** Подпись статуса заказа на языке страницы. */
  statusLabel: (status: string) => string;
};

export async function buildAccount(
  links: readonly BuyerShop[],
  tenants: ReadonlyMap<string, Tenant>,
  deps: Deps,
): Promise<Account> {
  // Только магазины на v2 и не в архиве: клиент прежней платформы для v2 невидим.
  const open = links.filter((l) => {
    const t = tenants.get(l.botId);
    return t && !t.archived && servedByV2(t) && t.settings.slug;
  });
  // Магазины читаются параллельно (у каждого своя роль и свои запросы), не больше ACCOUNT_SHOPS_MAX.
  const built = await Promise.all(
    open.slice(0, ACCOUNT_SHOPS_MAX).map(async (l) => {
      const tenant = tenants.get(l.botId)!;
      const ctx = deps.ctxFor(tenant);
      const customer = await getCustomer(ctx, l.userKey);
      const rows = customer ? await listCustomerOrders(ctx, customer, ORDERS_PER_SHOP) : [];
      const state = (customer?.state ?? {}) as { web_fav?: { ids?: unknown } };
      const ids = parseFavorites(JSON.stringify(state.web_fav?.ids ?? []));
      const products = ids.length > 0 ? await storeProductsByIds(ctx, ids) : [];
      const found: { at: string; text: string }[] = [];
      for (const o of rows) {
        const text = (o.fulfillment_address ?? "").trim().replace(/\s+/g, " ");
        if (text) found.push({ at: o.created_at, text });
      }
      const shop: AccountShop = {
        name: tenant.name,
        slug: tenant.settings.slug!,
        orders: rows.map((o) => ({
          id: o.id,
          no: displayNo(o),
          status: deps.statusLabel(o.status),
          total: Number(o.total),
          currency: o.currency,
          at: o.created_at,
        })),
        favorites: products
          .slice(0, FAVORITES_PER_SHOP)
          .map((p) => ({ id: p.id, name: p.name, price: p.price, currency: p.currency })),
        moreFavorites: Math.max(0, products.length - FAVORITES_PER_SHOP),
      };
      return { shop, found };
    }),
  );
  const shops: AccountShop[] = built.map((x) => x.shop);
  const addresses: { at: string; text: string }[] = built.flatMap((x) => x.found);
  // Адреса из заказов: новые первыми, одинаковые один раз.
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const a of addresses.sort((x, y) => (x.at < y.at ? 1 : x.at > y.at ? -1 : 0))) {
    const key = a.text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(a.text);
  }
  return {
    shops,
    moreShops: Math.max(0, open.length - ACCOUNT_SHOPS_MAX),
    addresses: unique.slice(0, ADDRESSES_MAX),
    moreAddresses: Math.max(0, unique.length - ADDRESSES_MAX),
  };
}

/**
 * «Заказать снова» из «Мои заказы» площадки (К3): план для заказа, который принадлежит
 * профилю человека в этом магазине. Магазин берётся только из связей человека и только
 * если он на v2 и не в архиве; чужой номер, чужой магазин, магазин прежней платформы — null.
 * Заказ не оформляется и ничего не списывает: корзина витрины живёт у покупателя в браузере,
 * сервер лишь отдаёт сегодняшние цены и остатки (planReorder).
 */
export async function reorderFromAccount(
  links: readonly BuyerShop[],
  tenants: ReadonlyMap<string, Tenant>,
  slug: string,
  orderId: number,
  deps: Pick<Deps, "ctxFor">,
): Promise<ReorderPlan | null> {
  for (const l of links) {
    const t = tenants.get(l.botId);
    if (!t || t.archived || !servedByV2(t) || t.settings.slug !== slug) continue;
    const ctx = deps.ctxFor(t);
    const customer = await getCustomer(ctx, l.userKey);
    if (!customer) return null;
    const { planReorderForCustomer } = await import("@/core/storefront/reorder");
    return planReorderForCustomer(ctx, customer, orderId);
  }
  return null;
}
