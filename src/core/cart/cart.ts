import { serverFailure } from "@/lib/server-failure";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Customer } from "@/core/customers/customers";
import { PRODUCT_SELECT, type Product } from "@/core/catalog/catalog";
import {
  deliveryPriceMultiplier,
  materialLanguages,
  productSellable,
  type DeliveryLangChoice,
} from "@/core/catalog/materials";
import { resolvePrice } from "@/core/pricing/pricing";
import type { Money } from "@/core/money/money";

export type AddToCartResult =
  "ok" | "unavailable" | "mixed_cart" | "digital_limit" | "out_of_stock" | "error";

export type CartItem = {
  id: string;
  quantity: number;
  product_variant_id: string | null;
  products: Product | null;
  product_variants: { id: string; name: string; price: number } | null;
};

/**
 * Корзина живёт в cart_items по telegram_id покупателя (у Instagram/WhatsApp
 * он синтетический, см. customers.ts) — тот же ключ, что у v1, чтобы
 * корзина пережила переезд клиента между версиями.
 */
export async function addToCart(
  ctx: TenantContext,
  customer: Customer,
  productId: string,
  variantId?: string | null,
): Promise<AddToCartResult> {
  const { data: product, error } = await ctx.db
    .from("products")
    .select(
      "id, is_active, stock_quantity, fulfillment_kind, file_path, file_url, file_path_kz, file_url_kz, product_material_files(language, file_path, file_name, sort_order)",
    )
    .eq("id", productId)
    .maybeSingle();
  if (error) return "error";
  if (!product?.is_active) return "unavailable";

  // callback_data приходит от клиента: вариант обязан принадлежать товару, а
  // товар с вариантами нельзя положить «без варианта» по служебной цене «от».
  if (variantId) {
    const { data: v, error: vError } = await ctx.db
      .from("product_variants")
      .select("id")
      .eq("id", variantId)
      .eq("product_id", productId)
      .maybeSingle();
    if (vError) throw serverFailure(`Корзина: ${vError.message}`);
    if (!v) return "unavailable";
  } else {
    const { data: any, error: anyError } = await ctx.db
      .from("product_variants")
      .select("id")
      .eq("product_id", productId)
      .limit(1)
      .maybeSingle();
    if (anyError) throw serverFailure(`Корзина: ${anyError.message}`);
    if (any) return "unavailable";
  }

  const kind = product.fulfillment_kind === "physical" ? "physical" : "digital";
  // Цифровой товар без файла — оплата без выдачи; отказ до корзины, не после.
  if (kind === "digital" && !productSellable(product)) return "unavailable";
  // Курс с потоками: набор во все потоки закончился — не продаём.
  if (kind === "digital" && ctx.tenant.modules.courses) {
    const { courseEnrollOpen } = await import("@/core/courses/enroll.server");
    if (!(await courseEnrollOpen(ctx, productId))) return "unavailable";
  }

  // Смешанная корзина не поддерживается: у цифрового и физического заказа
  // разные машины выдачи.
  const { data: other, error: otherError } = await ctx.db
    .from("cart_items")
    .select("products(fulfillment_kind)")
    .eq("telegram_id", customer.telegramId)
    .neq("product_id", productId)
    .limit(1)
    .maybeSingle();
  if (otherError) throw serverFailure(`Корзина: ${otherError.message}`);
  if (other) {
    const otherKind = other.products?.fulfillment_kind === "physical" ? "physical" : "digital";
    if (otherKind !== kind) return "mixed_cart";
  }

  let existingQ = ctx.db
    .from("cart_items")
    .select("id, quantity")
    .eq("telegram_id", customer.telegramId)
    .eq("product_id", productId);
  existingQ = variantId
    ? existingQ.eq("product_variant_id", variantId)
    : existingQ.is("product_variant_id", null);
  const { data: existing } = await existingQ.maybeSingle();

  // Копия того же файла смысла не имеет.
  if (kind === "digital" && existing) return "digital_limit";

  // Предзаказ (core/preorder): сверх остатка берём, пока продавец его не выключил.
  const preorder = ctx.tenant.modules.stock
    ? await (await import("@/core/preorder/preorder")).getPreorder(ctx, productId)
    : null;
  if (ctx.tenant.modules.stock && product.stock_quantity !== null && !preorder) {
    const { data: rows, error: rowsError } = await ctx.db
      .from("cart_items")
      .select("quantity")
      .eq("telegram_id", customer.telegramId)
      .eq("product_id", productId);
    if (rowsError) throw serverFailure(`Корзина: ${rowsError.message}`);
    const already = (rows ?? []).reduce((s, r) => s + (Number(r.quantity) || 0), 0);
    if (already + 1 > product.stock_quantity) return "out_of_stock";
  }

  if (existing) {
    const { error: e } = await ctx.db
      .from("cart_items")
      .update({ quantity: existing.quantity + 1 })
      .eq("id", existing.id);
    return e ? "error" : "ok";
  }
  const { error: e } = await ctx.db.from("cart_items").insert({
    bot_id: ctx.tenant.id,
    telegram_id: customer.telegramId,
    user_key: customer.userKey,
    product_id: productId,
    product_variant_id: variantId ?? null,
    quantity: 1,
  });
  return e ? "error" : "ok";
}

export async function listCart(ctx: TenantContext, customer: Customer): Promise<CartItem[]> {
  const { data, error } = await ctx.db
    .from("cart_items")
    .select(
      `id, quantity, product_variant_id, products(${PRODUCT_SELECT}), product_variants(id, name, price)`,
    )
    .eq("telegram_id", customer.telegramId)
    .order("created_at");
  if (error) throw new Error(`cart: ${error.message}`);
  return (data ?? []) as unknown as CartItem[];
}

export async function cartCount(ctx: TenantContext, customer: Customer): Promise<number> {
  const { count, error: countError } = await ctx.db
    .from("cart_items")
    .select("id", { count: "exact", head: true })
    .eq("telegram_id", customer.telegramId);
  if (countError) throw serverFailure(`Корзина: ${countError.message}`);
  return count ?? 0;
}

export async function removeCartItem(
  ctx: TenantContext,
  customer: Customer,
  itemId: string,
): Promise<void> {
  const { error } = await ctx.db
    .from("cart_items")
    .delete()
    .eq("id", itemId)
    .eq("telegram_id", customer.telegramId);
  if (error) throw serverFailure(`Корзина: ${error.message}`);
}

export async function clearCart(ctx: TenantContext, customer: Customer): Promise<void> {
  const { error } = await ctx.db.from("cart_items").delete().eq("telegram_id", customer.telegramId);
  if (error) throw serverFailure(`Корзина: ${error.message}`);
}

export type PricedLine = {
  item: CartItem;
  name: string;
  unit: Money;
  line: number;
  /** ×N за «все языки» (модуль multi_language): сколько комплектов в цене. */
  copies: number;
};
export type PricedCart = {
  lines: PricedLine[];
  total: number;
  currency: string;
  kind: "digital" | "physical";
  /** Строки в разных валютах: сумму не сложить — заказ не оформляется. */
  mixedCurrency: boolean;
};

/** Тот же расчёт, что показывает цены в каталоге: корзина, заказ и карточка не расходятся. */
export async function priceCart(
  ctx: TenantContext,
  items: CartItem[],
  countryCode: string | null,
  opts: { deliveryLang?: DeliveryLangChoice | null } = {},
): Promise<PricedCart> {
  const lines: PricedLine[] = [];
  let total = 0;
  let currency = "KZT";
  let kind: "digital" | "physical" = "digital";
  let mixedCurrency = false;
  const choice = ctx.tenant.modules.multi_language ? (opts.deliveryLang ?? null) : null;
  for (const item of items) {
    const p = item.products;
    if (!p) continue;
    if (p.fulfillment_kind === "physical") kind = "physical";
    const unit = await resolvePrice(ctx, p, countryCode, item.product_variants);
    // $50 и 2000 ₸ не складываются в «2050 ₸»: курса нет — оформлять нельзя.
    if (lines.length > 0 && unit.currency.toUpperCase() !== currency.toUpperCase())
      mixedCurrency = true;
    currency = unit.currency;
    // «Все языки» — как N комплектов по числу языков этого товара.
    const copies =
      p.fulfillment_kind === "physical"
        ? 1
        : deliveryPriceMultiplier(choice, materialLanguages(p).length);
    const line = unit.amount * copies * Number(item.quantity);
    total += line;
    const name = item.product_variants ? `${p.name} (${item.product_variants.name})` : p.name;
    lines.push({ item, name, unit, line, copies });
  }
  return { lines, total, currency, kind, mixedCurrency };
}
