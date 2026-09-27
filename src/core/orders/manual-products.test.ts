import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { manualOrderProducts } from "./physical-admin";

const BOT = "00000000-0000-0000-0000-0000000000aa";

function setup(n: number, modules: Record<string, boolean> = {}) {
  // Потолок ответа как у Supabase: без постраничного чтения форма видела бы 1000.
  const db = fakeDb({ maxRows: 1000 });
  db.tables.products = Array.from({ length: n }, (_, i) => ({
    id: `p${String(i).padStart(5, "0")}`,
    bot_id: BOT,
    name: `Товар ${i}`,
    price: 100 + i,
    currency: "KZT",
    lead_time_days: i % 3,
    stock_quantity: 5,
    is_active: true,
    fulfillment_kind: "physical",
    // Все с одним порядком и одинаковым названием — порядок держит только id.
    sort_order: 0,
    product_variants:
      i === 0
        ? [
            { id: "v2", name: "Б", price: 5, sort_order: 2 },
            { id: "v1", name: "А", price: 3, sort_order: 1 },
          ]
        : [],
  }));
  db.tables.products.push(
    { ...db.tables.products[1]!, id: "digital", fulfillment_kind: "digital" },
    { ...db.tables.products[1]!, id: "hidden", is_active: false },
  );
  const ctx = { tenant: { id: BOT, modules, settings: {} }, db } as unknown as TenantContext;
  return ctx;
}

describe("форма ручного заказа: физические товары", () => {
  it("читает постранично: больше 1000 товаров, без повторов и пропусков", async () => {
    const out = await manualOrderProducts(setup(2500));
    expect(out).toHaveLength(2500);
    expect(new Set(out.map((p) => p.id)).size).toBe(2500);
    expect(out.some((p) => p.id === "digital" || p.id === "hidden")).toBe(false);
  });

  it("карточка: цена, срок, варианты по порядку; остаток — только со складским учётом", async () => {
    const [first] = await manualOrderProducts(setup(1));
    expect(first).toEqual({
      id: "p00000",
      name: "Товар 0",
      price: 100,
      currency: "KZT",
      leadDays: 0,
      stock: null,
      variants: [
        { id: "v1", name: "А", price: 3 },
        { id: "v2", name: "Б", price: 5 },
      ],
    });
    const [withStock] = await manualOrderProducts(setup(1, { stock: true }));
    expect(withStock!.stock).toBe(5);
  });
});
