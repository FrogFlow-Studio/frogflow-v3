import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Customer } from "@/core/customers/customers";
import { listCart } from "@/core/cart/cart";
import { setProductVariants } from "./admin";

const BOT = "00000000-0000-0000-0000-0000000000ca";

function setup() {
  const db = fakeDb();
  db.tables.products = [
    {
      id: "cake",
      bot_id: BOT,
      name: "Торт",
      price: 10000,
      is_active: true,
      fulfillment_kind: "physical",
    },
  ];
  db.tables.product_variants = [
    { id: "v1", bot_id: BOT, product_id: "cake", name: "1 кг", price: 10000, sort_order: 0 },
    { id: "v2", bot_id: BOT, product_id: "cake", name: "2 кг", price: 18000, sort_order: 1 },
  ];
  db.tables.cart_items = [
    {
      id: "c1",
      telegram_id: -1,
      product_id: "cake",
      product_variant_id: "v2",
      quantity: 1,
      products: { id: "cake" },
    },
  ];
  db.tables.order_items = [{ id: "o1", order_id: 1, product_id: "cake", product_variant_id: "v2" }];
  const ctx = { tenant: { id: BOT, modules: {} }, db } as unknown as TenantContext;
  const customer = { userKey: "ig_1", telegramId: -1, platform: "instagram" } as Customer;
  return { db, ctx, customer };
}

describe("setProductVariants: пересохранение карточки", () => {
  it("неизменённые варианты остаются с теми же id — корзина и заказ не теряют вариант", async () => {
    const { db, ctx } = setup();
    await setProductVariants(ctx, "cake", [
      { name: "1 кг", price: 10000 },
      { name: "2 кг", price: 18000 },
    ]);
    expect(db.tables.product_variants!.map((v) => v.id)).toEqual(["v1", "v2"]);
    expect(db.tables.cart_items![0]!.product_variant_id).toBe("v2");
  });

  it("цена и порядок меняются у того же варианта, новый добавляется, убранный удаляется", async () => {
    const { db, ctx } = setup();
    await setProductVariants(ctx, "cake", [
      { name: "2 кг", price: 19000 },
      { name: "3 кг", price: 25000 },
    ]);
    const rows = db.tables.product_variants!;
    expect(rows.find((v) => v.id === "v2")).toMatchObject({ price: 19000, sort_order: 0 });
    expect(rows.find((v) => v.id === "v1")).toBeUndefined();
    expect(rows.find((v) => v.name === "3 кг")).toMatchObject({ price: 25000, sort_order: 1 });
    expect(rows).toHaveLength(2);
  });

  it("корзина с удалённым вариантом не продаётся по цене «от»", async () => {
    const { db, ctx, customer } = setup();
    await setProductVariants(ctx, "cake", [
      { name: "1 кг", price: 10000 },
      { name: "3 кг", price: 25000 },
    ]);
    // Внешний ключ ON DELETE SET NULL: у позиции вариант стал пустым.
    db.tables.cart_items![0]!.product_variant_id = null;
    expect(await listCart(ctx, customer)).toEqual([]);
    expect(db.tables.cart_items).toHaveLength(0);
  });

  it("товар без вариантов: строка корзины без варианта остаётся", async () => {
    const { db, ctx, customer } = setup();
    db.tables.product_variants = [];
    db.tables.cart_items![0]!.product_variant_id = null;
    expect(await listCart(ctx, customer)).toHaveLength(1);
  });
});
