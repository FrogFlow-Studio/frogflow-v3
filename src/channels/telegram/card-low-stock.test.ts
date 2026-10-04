import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Product } from "@/core/catalog/catalog";
import { LOW_STOCK_DEFAULT_KEY, LOW_STOCK_SHOW_KEY } from "@/core/catalog/low-stock";
import { productCard } from "./screens";

const BOT = "00000000-0000-0000-0000-0000000000c5";
const product = (stock: number | null) =>
  ({
    id: "00000000-0000-4000-8000-000000000002",
    name: "Торт",
    description: "Вкусный",
    price: 10000,
    currency: "KZT",
    country_prices: {},
    fulfillment_kind: "physical",
    stock_quantity: stock,
    category_ids: [],
    product_images: [],
    product_variants: [],
  }) as unknown as Product;

function ctx(settings: Record<string, string>) {
  const db = fakeDb();
  db.tables.app_settings = Object.entries(settings).map(([key, value]) => ({
    bot_id: BOT,
    key,
    value,
  }));
  db.tables.order_items = [];
  return {
    tenant: { id: BOT, modules: { stock: true }, settings: { served_by: "v2" } },
    db,
    timezone: "Asia/Almaty",
  } as unknown as TenantContext;
}

const on = { [LOW_STOCK_SHOW_KEY]: "1", [LOW_STOCK_DEFAULT_KEY]: "5" };

describe("карточка товара в боте: «осталось мало»", () => {
  it("с согласием продавца — строка с числом на языке покупателя", async () => {
    expect((await productCard(ctx(on), product(3), "ru", null)).caption).toContain(
      "Осталось 3 шт.",
    );
    expect((await productCard(ctx(on), product(3), "en", null)).caption).toContain("Only 3 left");
    expect((await productCard(ctx(on), product(3), "uz", null)).caption).toContain("3 dona qoldi");
  });

  it("без согласия, выше порога и при нулевом остатке строки нет", async () => {
    const off = { [LOW_STOCK_DEFAULT_KEY]: "5" };
    expect((await productCard(ctx(off), product(3), "ru", null)).caption).not.toContain("Осталось");
    expect((await productCard(ctx(on), product(9), "ru", null)).caption).not.toContain("Осталось");
    const sold = (await productCard(ctx(on), product(0), "ru", null)).caption;
    expect(sold).not.toContain("Осталось");
    expect(sold).toContain("Нет в наличии");
  });
});
