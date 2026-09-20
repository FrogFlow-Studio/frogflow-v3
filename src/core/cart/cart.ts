import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Customer } from "@/core/customers/customers";
import { PRODUCT_SELECT, type Product } from "@/core/catalog/catalog";
import { productSellable } from "@/core/catalog/materials";
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
    const { data: v } = await ctx.db
      .from("product_variants")
      .select("id")
      .eq("id", variantId)
      .eq("product_id", productId)
      .maybeSingle();
    if (!v) return "unavailable";
  } else {
    const { data: any } = await ctx.db
      .from("product_variants")
      .select("id")
      .eq("product_id", productId)
      .limit(1)
      .maybeSingle();
    if (any) return "unavailable";
  }

  const kind = product.fulfillment_kind === "physical" ? "physical" : "digital";
  // Цифровой товар без файла — оплата без выдачи; отказ до корзины, не после.
  if (kind === "digital" && !productSellable(product)) return "unavailable";

  // Смешанная корзина не поддерживается: у цифрового и физического заказа
  // разные машины выдачи.
  const { data: other } = await ctx.db
    .from("cart_items")
    .select("products(fulfillment_kind)")
    .eq("telegram_id", customer.telegramId)
    .neq("product_id", productId)
    .limit(1)
    .maybeSingle();
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

  if (ctx.tenant.modules.stock && product.stock_quantity !== null) {
    const { data: rows } = await ctx.db
      .from("cart_items")
      .select("quantity")
      .eq("telegram_id", customer.telegramId)
      .eq("product_id", productId);
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
  const { count } = await ctx.db
    .from("cart_items")
    .select("id", { count: "exact", head: true })
    .eq("telegram_id", customer.telegramId);
  return count ?? 0;
}

export async function removeCartItem(
  ctx: TenantContext,
  customer: Customer,
  itemId: string,
): Promise<void> {
  await ctx.db.from("cart_items").delete().eq("id", itemId).eq("telegram_id", customer.telegramId);
}

export async function clearCart(ctx: TenantContext, customer: Customer): Promise<void> {
  await ctx.db.from("cart_items").delete().eq("telegram_id", customer.telegramId);
}

export type PricedLine = { item: CartItem; name: string; unit: Money; line: number };
export type PricedCart = {
  lines: PricedLine[];
  total: number;
  currency: string;
  kind: "digital" | "physical";
};

/** Тот же расчёт, что показывает цены в каталоге: корзина, заказ и карточка не расходятся. */
export async function priceCart(
  ctx: TenantContext,
  items: CartItem[],
  countryCode: string | null,
): Promise<PricedCart> {
  const lines: PricedLine[] = [];
  let total = 0;
  let currency = "KZT";
  let kind: "digital" | "physical" = "digital";
  for (const item of items) {
    const p = item.products;
    if (!p) continue;
    if (p.fulfillment_kind === "physical") kind = "physical";
    const unit = await resolvePrice(ctx, p, countryCode, item.product_variants);
    currency = unit.currency;
    const line = unit.amount * Number(item.quantity);
    total += line;
    const name = item.product_variants ? `${p.name} (${item.product_variants.name})` : p.name;
    lines.push({ item, name, unit, line });
  }
  return { lines, total, currency, kind };
}
