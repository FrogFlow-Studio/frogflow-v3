import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { storeProductsByIds } from "./catalog";
import { FAVORITES_MAX, parseFavorites, pruneFavorites, toggleFavorite } from "./favorites";

const BOT = "00000000-0000-0000-0000-000000000001";
const HIDDEN = "00000000-0000-4000-8000-00000000c0de";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

describe("избранное: список в браузере", () => {
  it("битое значение, не uuid и повторы отбрасываются", () => {
    expect(parseFavorites(null)).toEqual([]);
    expect(parseFavorites("{не json")).toEqual([]);
    expect(parseFavorites('{"a":1}')).toEqual([]);
    expect(parseFavorites(JSON.stringify([id(1), "x", 5, id(1), id(2)]))).toEqual([id(1), id(2)]);
  });

  it("добавить — первым, повтор снимает; потолок списка", () => {
    expect(toggleFavorite([id(1)], id(2))).toEqual([id(2), id(1)]);
    expect(toggleFavorite([id(2), id(1)], id(2))).toEqual([id(1)]);
    const full = Array.from({ length: FAVORITES_MAX }, (_, i) => id(i + 1));
    const next = toggleFavorite(full, id(999));
    expect(next).toHaveLength(FAVORITES_MAX);
    expect(next[0]).toBe(id(999));
  });

  it("пропавшие товары убираются, порядок остальных сохраняется", () => {
    expect(pruneFavorites([id(3), id(2), id(1)], [id(1), id(3)])).toEqual([id(3), id(1)]);
  });
});

function shop(count: number) {
  const db = fakeDb({ maxRows: 1000 });
  db.tables.products = Array.from({ length: count }, (_, i) => {
    const n = i + 1;
    return {
      id: id(n),
      bot_id: BOT,
      name: `Товар ${n}`,
      description: "",
      price: 100 * n,
      currency: "KZT",
      country_prices: {},
      // 2-й снят с продажи, 3-й — в скрытой категории.
      is_active: n !== 2,
      sort_order: n,
      fulfillment_kind: "physical",
      stock_quantity: null,
      category_ids: n === 3 ? [HIDDEN] : [],
      rating_count: 0,
      rating_avg: 0,
      created_at: "2026-01-01T00:00:00Z",
      product_images: [],
      product_variants: [],
      product_material_files: [],
    };
  });
  db.tables.categories = [{ id: HIDDEN, name: "Скрытая", parent_id: null, is_visible: false }];
  return { tenant: { id: BOT, modules: {}, settings: {} }, db } as unknown as TenantContext;
}

describe("storeProductsByIds: карточки избранного", () => {
  it("порядок как в списке; снятое, скрытое и несуществующее пропускаются", async () => {
    const ctx = shop(5);
    const out = await storeProductsByIds(ctx, [id(5), id(2), id(3), id(404), id(1)]);
    expect(out.map((p) => p.id)).toEqual([id(5), id(1)]);
  });

  it("пустой список — без запроса к базе", async () => {
    expect(await storeProductsByIds(shop(1), [])).toEqual([]);
  });

  it("длиннее куска в 200 читается целиком", async () => {
    const ctx = shop(450);
    const ids = Array.from({ length: 450 }, (_, i) => id(i + 1));
    const out = await storeProductsByIds(ctx, ids);
    expect(out).toHaveLength(448);
  });
});
