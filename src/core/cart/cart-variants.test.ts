import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Customer } from "@/core/customers/customers";
import { addToCart } from "./cart";

const BOT = "00000000-0000-0000-0000-0000000000ca";

function setup() {
  const db = fakeDb();
  db.tables.products = [
    {
      id: "cake",
      bot_id: BOT,
      is_active: true,
      stock_quantity: null,
      fulfillment_kind: "physical",
      product_material_files: [],
    },
  ];
  db.tables.product_variants = [
    { id: "v-small", product_id: "cake", name: "1 кг", price: 1000 },
    { id: "v-big", product_id: "cake", name: "2 кг", price: 1800 },
  ];
  db.tables.cart_items = [];
  const ctx = { tenant: { id: BOT, modules: {} }, db } as unknown as TenantContext;
  const customer = { userKey: "ig_1", telegramId: -1, platform: "instagram" } as Customer;
  return { db, ctx, customer };
}

describe("addToCart: товар с вариантами", () => {
  it("товар с вариантами без выбранного варианта в корзину не попадает", async () => {
    // Postback можно подделать мимо показанных кнопок: без варианта заказ
    // посчитался бы по служебной «цене от» товара.
    const { db, ctx, customer } = setup();
    expect(await addToCart(ctx, customer, "cake", null)).toBe("unavailable");
    expect(await addToCart(ctx, customer, "cake")).toBe("unavailable");
    expect(db.tables.cart_items).toHaveLength(0);
  });

  it("два разных варианта — две раздельные строки корзины", async () => {
    const { db, ctx, customer } = setup();
    expect(await addToCart(ctx, customer, "cake", "v-small")).toBe("ok");
    expect(await addToCart(ctx, customer, "cake", "v-big")).toBe("ok");
    expect(db.tables.cart_items!.map((r) => r.product_variant_id)).toEqual(["v-small", "v-big"]);
  });

  it("чужой вариант к товару не прикладывается", async () => {
    const { db, ctx, customer } = setup();
    db.tables.product_variants!.push({ id: "v-other", product_id: "other", name: "x", price: 1 });
    expect(await addToCart(ctx, customer, "cake", "v-other")).toBe("unavailable");
    expect(db.tables.cart_items).toHaveLength(0);
  });
});
