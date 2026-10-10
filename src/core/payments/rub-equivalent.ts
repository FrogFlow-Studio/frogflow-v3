import type { TenantContext } from "@/core/tenant/resolve.server";
import { manualCountryPrice } from "@/core/money/money";
import { inChunks } from "@/lib/in-chunks";
import type { ProdamusConfig } from "./prodamus";

/**
 * Рубли рядом с тенге в «К оплате»: «1700 ₸ / ≈470 ₽». Покупатели из России
 * принимали 1700 за рубли (Копилка Русоведа, 10.10), а картой РФ платят через
 * Продамус. Только рублёвая цена товара (country_prices.RU), которую задаёт
 * продавец, — если она есть у каждого товара заказа и заказ без скидок. По
 * курсу не пересчитываем (Яков, 10.10: «лучше чтобы она сама писала»).
 * Всегда с «≈»: списание с карты РФ считает Продамус из суммы в ₸, рубли
 * отличаются на несколько. null — без Продамуса, не тенге или рублёвой цены нет.
 *
 * Чтение мягкое: строка только подсказка, при сбое базы — одни тенге.
 */
export async function rubEquivalent(
  ctx: TenantContext,
  cfg: (ProdamusConfig & { ready: true }) | { ready: false },
  order: { id: number; due: number; currency: string },
): Promise<{ amount: number } | null> {
  if (!cfg.ready || order.currency.toUpperCase() !== "KZT" || !(order.due > 0)) return null;
  const { data: items, error } = await ctx.db
    .from("order_items")
    .select("product_id, quantity, price_snapshot")
    .eq("order_id", order.id);
  if (error || !items?.length) return null;
  const ids = [...new Set(items.map((i) => i.product_id).filter((x): x is string => !!x))];
  if (ids.length === 0) return null;
  const products = await inChunks(
    ids,
    (chunk) => ctx.db.from("products").select("id, country_prices").in("id", chunk),
    "Товары заказа",
  ).catch(() => null);
  if (!products) return null;
  const ru = new Map(products.map((p) => [p.id, manualCountryPrice(p.country_prices, "RU")]));
  let rub = 0;
  let kzt = 0;
  for (const i of items) {
    const price = i.product_id ? ru.get(i.product_id) : null;
    if (!price) return null;
    rub += price * i.quantity;
    kzt += Number(i.price_snapshot) * i.quantity;
  }
  // Скидка, баллы или предоплата — рублёвые цены уже не та сумма.
  if (Math.abs(kzt - order.due) > 0.005) return null;
  return { amount: rub };
}

export function withRub(tenge: string, rub: { amount: number } | null): string {
  return rub ? `${tenge} / ≈${rub.amount} ₽` : tenge;
}
