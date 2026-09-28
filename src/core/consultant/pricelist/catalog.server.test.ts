import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { findProducts } from "./catalog";
import { withSynonyms } from "./synonyms";
import { CATALOG_KEY, SYNONYMS_KEY, loadPricelist, savePricelist } from "./catalog.server";

const product = (id: string, name: string, over: Record<string, unknown> = {}) => ({
  id,
  name,
  category: "Полотенца",
  size: "50x100",
  colors: ["белый"],
  price_kzt: 24000,
  stock: true,
  ...over,
});

function shop(id: string, rows: Array<{ key: string; value: string }>) {
  const db = fakeDb({ unique: { app_settings: [["bot_id", "key"]] } });
  db.tables.app_settings = rows.map((r) => ({ bot_id: id, ...r }));
  return { tenant: { id, modules: {}, settings: {} }, db } as unknown as TenantContext;
}

describe("прайс консультанта из базы", () => {
  it("прайс читается из consultant_catalog_json своего магазина", async () => {
    const a = shop("bot-a", [
      { key: CATALOG_KEY, value: JSON.stringify([product("1", "Полотенце PIP Studio")]) },
      { key: SYNONYMS_KEY, value: "pip, голландские" },
    ]);
    const b = shop("bot-b", [{ key: CATALOG_KEY, value: "не json" }]);
    const snapA = await loadPricelist(a, 1);
    expect(snapA.products.map((p) => p.name)).toEqual(["Полотенце PIP Studio"]);
    expect(snapA.shopUrl).toBe("https://bovi.kz");
    expect((await loadPricelist(b, 1)).products).toEqual([]);
    // Синонимы магазина работают только в его поиске.
    const found = withSynonyms(snapA.synonyms, () =>
      findProducts({ query: "голландские полотенца" }, snapA.products),
    );
    expect(found.all).toHaveLength(1);
  });

  it("снятые позиции не видны покупателю, видны продавцу", async () => {
    const ctx = shop("bot-c", [
      {
        key: CATALOG_KEY,
        value: JSON.stringify([
          product("1", "Матрас Dorelan"),
          product("2", "Плед-образец (не для продажи)", { category: "Пледы" }),
        ]),
      },
    ]);
    const snap = await loadPricelist(ctx, 1);
    expect(snap.products.map((p) => p.id)).not.toContain("2");
    expect(snap.hidden.map((p) => p.id)).toContain("2");
  });

  it("новый прайс сбрасывает кэш магазина", async () => {
    const ctx = shop("bot-d", []);
    expect((await loadPricelist(ctx, 1)).products).toEqual([]);
    const meta = await savePricelist(ctx, [product("9", "Плед")], "1c", new Date(2));
    expect(meta.count).toBe(1);
    expect((await loadPricelist(ctx, 3)).products.map((p) => p.id)).toEqual(["9"]);
  });
});
