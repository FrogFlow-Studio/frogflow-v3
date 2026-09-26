import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Customer } from "@/core/customers/customers";
import { addToCart } from "./cart";

const BOT = "00000000-0000-0000-0000-000000000001";
const TELEGRAM_ID = -515151;

const customer = { userKey: "ig_515151", telegramId: TELEGRAM_ID } as Customer;

function product(id: string, kind: "digital" | "physical") {
  return {
    id,
    bot_id: BOT,
    is_active: true,
    stock_quantity: null,
    fulfillment_kind: kind,
    file_path: kind === "digital" ? `${BOT}/${id}.pdf` : null,
    file_url: null,
    file_path_kz: null,
    file_url_kz: null,
    product_material_files: [],
  };
}

function setup(inCart: Array<ReturnType<typeof product>>) {
  const db = fakeDb();
  const products = [
    product("material", "digital"),
    product("material-2", "digital"),
    product("cake", "physical"),
    product("cake-2", "physical"),
  ];
  db.tables.products = products;
  db.tables.cart_items = inCart.map((p, i) => ({
    id: `ci-${i}`,
    bot_id: BOT,
    telegram_id: TELEGRAM_ID,
    user_key: customer.userKey,
    product_id: p.id,
    product_variant_id: null,
    quantity: 1,
    // Встроенный join PostgREST: строка корзины приходит вместе с товаром.
    products: { fulfillment_kind: p.fulfillment_kind },
  }));
  const ctx = { tenant: { id: BOT, modules: {} }, db } as unknown as TenantContext;
  return { db, ctx };
}

describe("addToCart — цифровое и физическое не смешиваются", () => {
  it("нельзя добавить физический товар, когда в корзине уже цифровой", async () => {
    const { db, ctx } = setup([product("material", "digital")]);
    expect(await addToCart(ctx, customer, "cake")).toBe("mixed_cart");
    expect(db.tables.cart_items).toHaveLength(1);
    // Другой цифровой — по-прежнему можно.
    expect(await addToCart(ctx, customer, "material-2")).toBe("ok");
  });

  it("нельзя добавить цифровой товар к физическому, второй физический — можно", async () => {
    const { ctx } = setup([product("cake", "physical")]);
    expect(await addToCart(ctx, customer, "material")).toBe("mixed_cart");
    expect(await addToCart(ctx, customer, "cake-2")).toBe("ok");
  });
});
