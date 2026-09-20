import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { liveReady, DEMO_BOT, TEST_TG_ID } from "./live";
import { serviceDb } from "@/core/db/client.server";
import { requireTenant, tenantContext, type TenantContext } from "@/core/tenant/resolve.server";
import {
  listChildCategories,
  listProductsInCategory,
  getProduct,
  searchProducts,
} from "@/core/catalog/catalog";
import { resolvePrice } from "@/core/pricing/pricing";
import { upsertCustomer, setState, userKey } from "@/core/customers/customers";
import { addToCart, listCart, priceCart, clearCart } from "@/core/cart/cart";
import {
  placeOrder,
  displayNo,
  getOrder,
  listActivePaymentMethods,
  claimOrderPlacement,
  releaseOrderPlacement,
} from "@/core/orders/orders";
import { productSellable } from "@/core/catalog/materials";

let ctx: TenantContext;
const createdOrders: number[] = [];

async function cleanup() {
  const db = serviceDb();
  for (const id of createdOrders) await db.from("orders").delete().eq("id", id);
  await db.from("cart_items").delete().eq("bot_id", DEMO_BOT).eq("telegram_id", TEST_TG_ID);
  await db
    .from("bot_users")
    .delete()
    .eq("bot_id", DEMO_BOT)
    .eq("user_key", userKey("telegram", TEST_TG_ID));
  await db.from("products").delete().eq("bot_id", DEMO_BOT).eq("name", PROBE_NAME);
  await db
    .from("payment_methods")
    .delete()
    .eq("bot_id", DEMO_BOT)
    .eq("country_name", "Казахстан (v2 probe)");
}

const PROBE_NAME = "v2 probe · цифровой материал";

/** У демо-клиента каталог пуст — заводим один цифровой товар под ключом арендатора. */
async function seedProbeProduct(): Promise<string> {
  const { data: p, error } = await ctx.db
    .from("products")
    .insert({
      bot_id: DEMO_BOT,
      name: PROBE_NAME,
      description: "тест v2",
      price: 1000,
      currency: "KZT",
      is_active: true,
      fulfillment_kind: "digital",
      category_ids: [],
      country_prices: {},
    })
    .select("id")
    .single();
  if (error || !p) throw new Error(`seed product: ${error?.message}`);
  const { error: fErr } = await ctx.db.from("product_material_files").insert({
    bot_id: DEMO_BOT,
    product_id: p.id,
    language: "ru",
    file_path: `${DEMO_BOT}/v2-probe/material.pdf`,
    file_name: "material.pdf",
    sort_order: 0,
  });
  if (fErr) throw new Error(`seed material: ${fErr.message}`);
  const { error: mErr } = await ctx.db.from("payment_methods").insert({
    bot_id: DEMO_BOT,
    country_code: "KZ",
    country_name: "Казахстан (v2 probe)",
    instructions: "Kaspi: тестовые реквизиты v2",
    currency: "KZT",
    is_active: true,
    sort_order: 0,
  });
  if (mErr) throw new Error(`seed payment method: ${mErr.message}`);
  return p.id;
}

describe.skipIf(!liveReady)("живая база: контур магазина на демо-клиенте", () => {
  beforeAll(async () => {
    ctx = tenantContext(await requireTenant({ by: "id", value: DEMO_BOT }));
    await cleanup();
    await seedProbeProduct();
  });
  afterAll(cleanup);

  it("каталог: категории, товары, карточка, поиск, цена", async () => {
    const roots = await listChildCategories(ctx, null);
    expect(Array.isArray(roots)).toBe(true);
    const { data: any } = await ctx.db
      .from("products")
      .select("id, name")
      .eq("is_active", true)
      .limit(1)
      .single();
    expect(any?.id).toBeTruthy();
    const p = await getProduct(ctx, any!.id);
    expect(p?.name).toBe(any!.name);
    const money = await resolvePrice(ctx, p!, null);
    expect(money.amount).toBeGreaterThanOrEqual(0);
    expect(money.currency).toMatch(/^[A-Z]{3}$/);
    const found = await searchProducts(ctx, any!.name.split(" ")[0] ?? any!.name);
    expect(found.some((f) => f.id === any!.id)).toBe(true);
    const inRoot = await listProductsInCategory(ctx, null);
    expect(Array.isArray(inRoot)).toBe(true);
  });

  it("покупатель → корзина → заказ со снимком позиций → очистка", async () => {
    const customer = await upsertCustomer(ctx, "telegram", TEST_TG_ID, {
      firstName: "v2",
      lastName: "probe",
      username: "v2probe",
    });
    expect(customer.userKey).toBe(`tg_${TEST_TG_ID}`);
    expect(customer.telegramId).toBe(TEST_TG_ID);

    // Продаваемый цифровой товар демо-клиента.
    const { data: candidates } = await ctx.db
      .from("products")
      .select(
        "id, fulfillment_kind, file_path, file_url, file_path_kz, file_url_kz, product_material_files(language, file_path, file_name, sort_order), product_variants(id)",
      )
      .eq("is_active", true)
      .limit(50);
    const sellable = (candidates ?? []).find(
      (c) =>
        c.fulfillment_kind !== "physical" &&
        productSellable(c) &&
        (c.product_variants ?? []).length === 0,
    );
    expect(sellable, "у демо-клиента нужен хотя бы один цифровой товар с файлом").toBeTruthy();

    expect(await addToCart(ctx, customer, sellable!.id)).toBe("ok");
    expect(await addToCart(ctx, customer, sellable!.id)).toBe("digital_limit");
    const items = await listCart(ctx, customer);
    expect(items).toHaveLength(1);

    const methods = await listActivePaymentMethods(ctx);
    expect(methods.length).toBeGreaterThan(0);
    const country = methods[0]!.country_code;
    const priced = await priceCart(ctx, items, country);
    expect(priced.lines).toHaveLength(1);

    // Атомарный захват: второй захват подряд не проходит.
    expect(await claimOrderPlacement(ctx, customer)).toBe(true);
    expect(await claimOrderPlacement(ctx, customer)).toBe(false);
    await releaseOrderPlacement(ctx, customer);

    const withCountry = await setState(ctx, customer, { ...customer.state, country_code: country });
    const result = await placeOrder(ctx, withCountry, country);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    createdOrders.push(result.order.id);
    expect(result.order.order_items).toHaveLength(1);
    expect(Number(result.order.total)).toBe(priced.total);
    expect(result.order.currency).toBe(priced.currency);
    expect(displayNo(result.order)).toBeGreaterThan(0);
    expect(result.order.bot_id).toBe(DEMO_BOT);
    const item = result.order.order_items[0]!;
    expect(item.product_id).toBe(sellable!.id);
    expect(item.material_files_by_lang).toBeTruthy();

    expect(await listCart(ctx, withCountry)).toHaveLength(0);
    const again = await getOrder(ctx, result.order.id);
    expect(again?.status).toBe("awaiting_payment");
    // placing_order снят
    const { data: u } = await ctx.db
      .from("bot_users")
      .select("state")
      .eq("user_key", customer.userKey)
      .single();
    expect((u?.state as { placing_order?: boolean })?.placing_order).toBeFalsy();
    await clearCart(ctx, withCountry);
  });
});
