import type { TenantContext } from "@/core/tenant/resolve.server";

/** Сколько совпадений каждого вида показываем в быстром поиске; остальное — ссылкой «все». */
export const SEARCH_SHOWN = 5;

export type AdminSearchResult = {
  orders: Array<{
    id: number;
    no: number | string;
    name: string;
    status: string;
    total: number;
    currency: string;
  }>;
  /** Заказов подошло больше, чем показано: «все» открывает список с тем же запросом. */
  ordersMore: boolean;
  products: Array<{ id: string; name: string }>;
  productsMore: boolean;
  customers: Array<{ key: string; name: string; platform: string; phone: string | null }>;
  customersMore: boolean;
};

/**
 * Быстрый поиск по админке: заказ по номеру или телефону, покупатель по имени и
 * телефону, товар по названию. Бухгалтеру — только заказы по номеру (без имён и
 * контактов), товаров и покупателей он не видит: эти разделы ему закрыты.
 */
export async function adminSearch(
  ctx: TenantContext,
  rawQuery: string,
  accountant: boolean,
): Promise<AdminSearchResult> {
  const orders = await import("@/core/orders/admin");
  const { accountantSearch, redactOrders } = await import("@/core/orders/redact");
  const { listProductsForAdmin } = await import("@/core/catalog/admin");
  const { displayNo } = await import("@/core/orders/pure");
  const q = accountant ? accountantSearch(rawQuery) : rawQuery;
  const [os, ps, cs] = await Promise.all([
    q ? orders.listOrdersForAdmin(ctx, { q, limit: SEARCH_SHOWN + 1 }) : Promise.resolve([]),
    accountant ? Promise.resolve(null) : listProductsForAdmin(ctx, { q: rawQuery }),
    accountant ? Promise.resolve([]) : orders.listCustomers(ctx, rawQuery, SEARCH_SHOWN + 1),
  ]);
  const shownOrders = os.slice(0, SEARCH_SHOWN);
  return {
    orders: (accountant ? redactOrders(shownOrders) : shownOrders).map((o) => ({
      id: o.id,
      no: displayNo(o),
      name: o.display_name ?? "",
      status: o.status,
      total: Number(o.total),
      currency: o.currency,
    })),
    ordersMore: os.length > SEARCH_SHOWN,
    products: (ps?.rows ?? []).slice(0, SEARCH_SHOWN).map((p) => ({ id: p.id, name: p.name })),
    productsMore: (ps?.total ?? 0) > SEARCH_SHOWN,
    customers: cs.slice(0, SEARCH_SHOWN).map((c) => ({
      key: c.user_key,
      name:
        [c.first_name, c.last_name].filter(Boolean).join(" ") ||
        (c.username ? `@${c.username}` : c.user_key),
      platform: c.platform,
      phone: c.contact_phone,
    })),
    customersMore: cs.length > SEARCH_SHOWN,
  };
}
