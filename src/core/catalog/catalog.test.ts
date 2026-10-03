import { describe, expect, it } from "vitest";
import { imageUrl, productSearchIds, searchProducts } from "./catalog";
import { fakeDb } from "../../../tests/fake-db";
import { decodeImageKey, encodeImageKey } from "./image-url";
import type { TenantContext } from "@/core/tenant/resolve.server";

const ctx = {
  appUrl: "https://app.test",
  tenant: { id: "0bac1f86-5231-4e57-838d-2faa44d427e7" },
} as TenantContext;

describe("imageUrl", () => {
  it("ключ с префиксом и без него дают один адрес", () => {
    const a = imageUrl(ctx, "0bac1f86-5231-4e57-838d-2faa44d427e7/a.png");
    expect(a).toBe(
      `https://app.test/api/img/0bac1f86-5231-4e57-838d-2faa44d427e7/${encodeImageKey(ctx.tenant.id, "a.png")}`,
    );
    expect(decodeImageKey(a.split("/").pop()!)).toBe("a.png");
    expect(decodeImageKey(imageUrl(ctx, "1783414427610-x7i24b.jpeg").split("/").pop()!)).toBe(
      "1783414427610-x7i24b.jpeg",
    );
    expect(a).not.toMatch(/\.png$/);
    expect(decodeImageKey("../x")).toBeNull();
  });

  it("закодированный выход из каталога не декодируется в ключ", () => {
    const enc = (s: string) => encodeImageKey("x", s);
    expect(decodeImageKey(enc("%2e%2e/%2e%2e/rest/v1/bots"))).toBeNull();
    expect(decodeImageKey(enc("../other/a.png"))).toBeNull();
    expect(decodeImageKey(enc("a.png?select=*"))).toBeNull();
    expect(decodeImageKey(enc("a\\..\\b"))).toBeNull();
  });
});

describe("searchProducts — поиск в боте", () => {
  const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const shop = (variantCount: number) => {
    const db = fakeDb({ maxRows: 1000 });
    db.tables.products = Array.from({ length: variantCount }, (_, i) => ({
      id: id(i + 1),
      name: `Футболка ${i + 1}`,
      keywords: null,
      description: null,
      is_active: true,
      sort_order: i,
    }));
    // У каждого товара по варианту «Белый»: совпадений больше 200.
    db.tables.product_variants = db.tables.products.map((p, i) => ({
      id: id(10_000 + i),
      product_id: p.id,
      name: "Белый",
    }));
    return { ...ctx, db } as unknown as TenantContext;
  };

  it("450 вариантов с совпадением — находятся все (до лимита), без длинного or", async () => {
    const c = shop(450);
    const ors: string[] = [];
    const db = c.db as unknown as { from: (t: string) => { or: (e: string) => unknown } };
    const origFrom = db.from.bind(db);
    db.from = (table: string) => {
      const q = origFrom(table);
      const or = q.or.bind(q);
      q.or = (e: string) => (ors.push(e), or(e));
      return q;
    };
    const found = await searchProducts(c, "бел", 500);
    expect(found).toHaveLength(450);
    expect(new Set(found.map((p) => p.id)).size).toBe(450);
    expect(found[0]!.id).toBe(id(1));
    expect(ors.every((e) => e.length < 300)).toBe(true);
    expect((await searchProducts(c, "бел", 50)).map((p) => p.id)).toEqual(
      found.slice(0, 50).map((p) => p.id),
    );
  });

  it("совпадение по названию и по варианту одного товара не двоится", async () => {
    const c = shop(3);
    expect((await searchProducts(c, "Футболка", 10)).map((p) => p.id)).toEqual([
      id(1),
      id(2),
      id(3),
    ]);
  });

  it("ошибка чтения вариантов — serverFailure, а не «ничего не найдено»", async () => {
    const c = shop(3);
    (c.db as unknown as { from: unknown }).from = (table: string) =>
      table === "product_variants"
        ? {
            select: () => ({
              ilike: () => ({
                order: () => ({ range: async () => ({ data: null, error: { message: "boom" } }) }),
              }),
            }),
          }
        : fakeDb().from(table);
    await expect(searchProducts(c, "бел")).rejects.toMatchObject({ name: "ServerFailure" });
  });

  it("витрина: 1500 вариантов с совпадением — набор id полный, без потолка в 1000", async () => {
    const c = shop(1500);
    expect((await productSearchIds(c, "%бел%")).size).toBe(1500);
  });
});
