import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { LOW_STOCK_DEFAULT_KEY, LOW_STOCK_SHOW_KEY } from "@/core/catalog/low-stock";
import { storeCatalog, storeProduct } from "./catalog";

const BOT = "00000000-0000-0000-0000-0000000000ab";
const P = "11111111-1111-4111-8111-111111111112";

function shop(settings: Record<string, string>, stock: number | null) {
  const db = fakeDb();
  db.tables.app_settings = Object.entries(settings).map(([key, value]) => ({
    bot_id: BOT,
    key,
    value,
  }));
  db.tables.order_items = [];
  db.tables.orders = [];
  db.tables.categories = [];
  db.tables.products = [
    {
      id: P,
      bot_id: BOT,
      name: "Торт",
      price: 2000,
      currency: "KZT",
      is_active: true,
      fulfillment_kind: "physical",
      stock_quantity: stock,
      category_ids: [],
      product_images: [],
      product_variants: [],
      product_material_files: [],
    },
  ];
  return {
    tenant: { id: BOT, modules: { stock: true }, settings: { served_by: "v2" } },
    timezone: "Asia/Almaty",
    db,
  } as unknown as TenantContext;
}

const on = { [LOW_STOCK_SHOW_KEY]: "1", [LOW_STOCK_DEFAULT_KEY]: "5" };

describe("витрина: «осталось мало»", () => {
  it("страница товара получает число, если продавец разрешил и остаток не больше порога", async () => {
    expect((await storeProduct(shop(on, 2), P))?.lowLeft).toBe(2);
  });
  it("без согласия или выше порога — null, остаток не раскрыт", async () => {
    expect((await storeProduct(shop({ [LOW_STOCK_DEFAULT_KEY]: "5" }, 2), P))?.lowLeft).toBeNull();
    expect((await storeProduct(shop(on, 9), P))?.lowLeft).toBeNull();
  });
  it("в списке каталога числа нет: остаток не уходит в карточки без согласия на чтение", async () => {
    const list = await storeCatalog(shop(on, 2), {});
    expect(list.every((p) => p.lowLeft === null)).toBe(true);
  });
});
