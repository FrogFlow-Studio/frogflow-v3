import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Customer } from "@/core/customers/customers";
import { listCart, priceCart } from "@/core/cart/cart";
import { cartSummary } from "@/core/orders/orders";
import { fulfillmentSettings } from "./fulfillment";
import {
  freeDeliveryStatus,
  goodsAfterDiscounts,
  loadFreeDeliveryRules,
  type FreeDeliveryRules,
  type FreeDeliveryStatus,
} from "./free-delivery";

/**
 * Корзина покупателя глазами бесплатной доставки: сколько товаров после
 * скидок и где порог. Для бота и Instagram/WhatsApp (корзина на сервере);
 * сайт считает по корзине браузера (webFulfillmentOptions). null — подсказывать
 * нечего: корзина пуста или без физических товаров, доставка выключена, порогов нет.
 */
export async function freeDeliveryView(
  ctx: TenantContext,
  customer: Customer,
): Promise<{
  rules: FreeDeliveryRules;
  forZone: (zoneId: string | null) => Promise<FreeDeliveryStatus | null>;
} | null> {
  const rules = await loadFreeDeliveryRules(ctx);
  if (rules.general === 0 && Object.keys(rules.zones).length === 0) return null;
  if (!(await fulfillmentSettings(ctx)).delivery) return null;
  const items = (await listCart(ctx, customer)).filter((it) => it.products);
  if (items.length === 0) return null;
  const st = customer.state;
  const priced = await priceCart(ctx, items, st.country_code ?? null);
  if (priced.kind !== "physical" || priced.mixedCurrency) return null;
  const sum = await cartSummary(ctx, customer, priced, {
    promoCode: st.promo_code,
    usePoints: st.use_points,
    giftCode: st.gift_certificate_code,
  });
  const goods = { amount: goodsAfterDiscounts(sum), currency: priced.currency };
  return { rules, forZone: (zoneId) => freeDeliveryStatus(ctx, rules, zoneId, goods) };
}
