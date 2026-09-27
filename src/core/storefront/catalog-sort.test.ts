import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { storeCatalog } from "./catalog";

/**
 * Сортировка Mini App на крупном каталоге: порядок задаёт запрос, а не
 * сортировка первых 200 товаров порядка продавца. У AATeach 459 товаров.
 */
const BOT = "00000000-0000-0000-0000-000000000001";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function shop(count: number) {
  const db = fakeDb({ maxRows: 1000 });
  db.tables.products = Array.from({ length: count }, (_, i) => {
    const n = i + 1;
    return {
      id: id(n),
      bot_id: BOT,
      name: `Прописи ${String(n).padStart(4, "0")}`,
      description: "",
      price: 10_000 - n,
      currency: "KZT",
      country_prices: {},
      is_active: true,
      sort_order: n,
      fulfillment_kind: "physical",
      stock_quantity: null,
      category_ids: [],
      rating_count: n === 450 ? 99 : n % 3,
      rating_avg: 4,
      created_at: new Date(Date.UTC(2026, 0, 1) + n * 3_600_000).toISOString(),
      product_images: [],
      product_variants: [],
      product_material_files: [],
    };
  });
  db.tables.categories = [];
  const ctx = {
    tenant: { id: BOT, modules: {}, settings: {} },
    db,
  } as unknown as TenantContext;
  return ctx;
}

describe("storeCatalog: сортировка по всему каталогу, а не по первым 200", () => {
  it("«Новые», «Цена» и «Популярные» на 459 товарах начинаются с товаров из конца порядка продавца", async () => {
    const ctx = shop(459);
    const top = async (sort: "new" | "price" | "popular") =>
      (await storeCatalog(ctx, { sort })).slice(0, 3).map((p) => p.name);
    expect(await top("new")).toEqual(["Прописи 0459", "Прописи 0458", "Прописи 0457"]);
    expect(await top("price")).toEqual(["Прописи 0459", "Прописи 0458", "Прописи 0457"]);
    expect((await top("popular"))[0]).toBe("Прописи 0450");
    expect((await storeCatalog(ctx, {}))[0]!.name).toBe("Прописи 0001");
  });

  it("равные по ключу товары идут по id — порядок одинаков при каждом открытии", async () => {
    const ctx = shop(30);
    const first = (await storeCatalog(ctx, { sort: "popular" })).map((p) => p.id);
    const again = (await storeCatalog(ctx, { sort: "popular" })).map((p) => p.id);
    expect(again).toEqual(first);
    // Внутри одинакового числа отзывов — по возрастанию id.
    const twos = first.filter((x) => Number(x.slice(-12)) % 3 === 2);
    expect(twos).toEqual([...twos].sort());
  });
});
