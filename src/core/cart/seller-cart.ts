import { serverFailure } from "@/lib/server-failure";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Customer } from "@/core/customers/customers";
import {
  addToCart,
  clearCart,
  listCart,
  priceCart,
  type AddToCartResult,
  type PricedCart,
} from "./cart";

/**
 * «Счёт из диалога»: продавец собирает покупателю корзину прямо из «Чата»,
 * покупатель получает её одним сообщением с кнопкой «Оформить заказ». Дальше
 * обычное оформление бота: страна и способ оплаты, промокод, баллы, доставка,
 * чек. Заказ сам не создаётся — корзина проходит те же проверки, что у
 * покупателя (товар скрыт, вариант чужой, смешанная корзина, склад), и цены
 * не расходятся с каталогом.
 *
 * Прежняя корзина покупателя заменяется счётом или, если продавец так
 * выбрал, счёт дописывается к ней. Если счёт собрать не удалось, корзина
 * возвращается как была.
 */
export type InvoiceItem = { productId: string; variantId: string | null; quantity: number };

export type InvoiceResult =
  | { ok: true; cart: PricedCart }
  | { ok: false; reason: Exclude<AddToCartResult, "ok"> | "empty"; productId?: string };

export const INVOICE_MAX_QTY = 99;

type CartRow = {
  bot_id: string;
  telegram_id: number;
  user_key: string | null;
  product_id: string;
  product_variant_id: string | null;
  quantity: number;
};

export async function fillCartForCustomer(
  ctx: TenantContext,
  customer: Customer,
  items: InvoiceItem[],
  opts: { append?: boolean } = {},
): Promise<InvoiceResult> {
  const wanted = items.filter((it) => it.quantity > 0);
  if (wanted.length === 0) return { ok: false, reason: "empty" };

  const { data: before, error } = await ctx.db
    .from("cart_items")
    .select("bot_id, telegram_id, user_key, product_id, product_variant_id, quantity")
    .eq("telegram_id", customer.telegramId);
  if (error) return { ok: false, reason: "error" };
  const snapshot = (before ?? []) as CartRow[];

  if (!opts.append) await clearCart(ctx, customer);
  for (const it of wanted) {
    const qty = Math.min(INVOICE_MAX_QTY, Math.floor(it.quantity));
    for (let i = 0; i < qty; i++) {
      const r = await addToCart(ctx, customer, it.productId, it.variantId);
      if (r !== "ok") {
        await restore(ctx, customer, snapshot);
        return { ok: false, reason: r, productId: it.productId };
      }
    }
  }
  const cart = await priceCart(
    ctx,
    (await listCart(ctx, customer)).filter((it) => it.products),
    customer.state.country_code ?? null,
  );
  return { ok: true, cart };
}

async function restore(ctx: TenantContext, customer: Customer, rows: CartRow[]): Promise<void> {
  await clearCart(ctx, customer);
  if (rows.length) {
    const { error } = await ctx.db.from("cart_items").insert(rows);
    if (error) throw serverFailure(`Корзина: возврат прежних позиций: ${error.message}`);
  }
}
