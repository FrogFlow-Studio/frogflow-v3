import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Customer } from "@/core/customers/customers";
import type { ConsultantProduct } from "./catalog";
import { pricelistMode } from "./mode";

/**
 * Товары, о которых шла речь перед передачей менеджеру (v1
 * consultant/notify.ts:75-121): для карточки продавцу в Telegram и для задачи
 * в админке. Берутся из state.consultant.last_product_ids — перечитываем
 * покупателя, runConsultant только что записал их поверх свежего состояния.
 */

/** Строка товара: «Название 70x140, белый (55 000 ₸)»; размер и цвет — если их нет в названии. */
export function productLine(p: ConsultantProduct): string {
  const size = p.size && !p.name.includes(p.size) ? ` ${p.size}` : "";
  const lower = p.name.toLowerCase();
  const own = (p.colors ?? []).filter((c) => c && !lower.includes(c.toLowerCase()));
  const colors = own.length ? `, ${own.join("/")}` : "";
  const price = p.price_kzt ? ` (${p.price_kzt.toLocaleString("ru-RU")} ₸)` : "";
  return `${p.name}${size}${colors}${price}`;
}

/** Строки товаров по id: неизвестные коды пропускаются, повторы схлопываются, не больше пяти. */
export function productLines(
  ids: readonly string[] | undefined,
  catalog: readonly ConsultantProduct[],
): string[] {
  const out: string[] = [];
  for (const id of ids ?? []) {
    const p = catalog.find((c) => c.id === id);
    if (!p) continue;
    const line = productLine(p);
    if (!out.includes(line)) out.push(line);
    if (out.length >= 5) break;
  }
  return out;
}

/**
 * Товары разговора строками. Не консультант по прайсу или сбой чтения —
 * пусто: передача и задача уходят без товаров, но уходят.
 */
export async function conversationProductLines(
  ctx: TenantContext,
  customer: Customer,
): Promise<string[]> {
  if (!pricelistMode(ctx.tenant)) return [];
  try {
    const { getCustomer } = await import("@/core/customers/customers");
    const { loadPricelist } = await import("./catalog.server");
    const [fresh, snap] = await Promise.all([
      getCustomer(ctx, customer.userKey),
      loadPricelist(ctx),
    ]);
    const c = ((fresh ?? customer).state.consultant ?? {}) as { last_product_ids?: unknown };
    const ids = Array.isArray(c.last_product_ids) ? c.last_product_ids.map(String) : [];
    return productLines(ids, [...snap.products, ...snap.hidden]);
  } catch (e) {
    console.warn(`[consultant:${ctx.tenant.id}] товары разговора не прочитаны`, e);
    return [];
  }
}
