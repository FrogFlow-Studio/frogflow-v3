import { describe, expect, it } from "vitest";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import { withBrokenReads } from "../../../tests/broken-db";
import { bulkUpdateProducts, scaleCountryPrices, scalePrice } from "./bulk";

const T = "11111111-2222-3333-4444-555555555555";
const CAT = "cccccccc-0000-4000-8000-000000000001";
const CAT2 = "cccccccc-0000-4000-8000-000000000002";
const pid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function setup(n: number, patch: (i: number) => Record<string, unknown> = () => ({})) {
  const db = fakeDb();
  db.tables.products = Array.from({ length: n }, (_, i) => ({
    id: pid(i + 1),
    name: `Товар ${i + 1}`,
    price: 1000,
    is_active: true,
    stock_quantity: null,
    category_ids: [],
    country_prices: {},
    description: `описание ${i + 1}`,
    sort_order: i,
    ...patch(i),
  }));
  db.tables.product_variants = [];
  db.tables.categories = [
    { id: CAT, name: "Торты" },
    { id: CAT2, name: "Печенье" },
  ];
  const ctx = { tenant: { id: T, modules: {} }, db } as unknown as TenantContext;
  return { ctx, db };
}

/** Размеры всех `.in(...)` в запросах: длинный список обязан идти кусками. */
function spyIn(db: FakeDb) {
  const sizes: number[] = [];
  const from = db.from.bind(db);
  db.from = (table: string) => {
    const q = from(table);
    const orig = q.in.bind(q);
    q.in = (col: string, vs: unknown[]) => {
      sizes.push(vs.length);
      return orig(col, vs);
    };
    return q;
  };
  return sizes;
}

describe("массовые действия: цена", () => {
  it("округление как в магазине — до целого", () => {
    expect(scalePrice(1000, 10)).toBe(1100);
    expect(scalePrice(999, 10)).toBe(1099);
    expect(scalePrice(1005, -15)).toBe(854);
    expect(scalePrice(10, 5)).toBe(11);
  });

  it("цены по странам: каждая ±%, ставшая меньше 1 остаётся", () => {
    expect(
      scaleCountryPrices({ KZ: 1000, RU: { price: 200, currency: "RUB" }, X: 1 }, -50),
    ).toEqual({
      KZ: 500,
      RU: { price: 100, currency: "RUB" },
      X: 1,
    });
  });
});

describe("массовые действия над товарами", () => {
  it("0 товаров — ничего не читается и не пишется", async () => {
    const { ctx, db } = setup(3);
    const sizes = spyIn(db);
    const r = await bulkUpdateProducts(ctx, [], { kind: "active", active: false });
    expect(r.changed).toEqual([]);
    expect(r.skipped).toEqual([]);
    expect(sizes).toEqual([]);
  });

  it("1 товар: скрыть меняет только is_active, остальные поля на месте", async () => {
    const { ctx, db } = setup(2);
    const r = await bulkUpdateProducts(ctx, [pid(1)], { kind: "active", active: false });
    expect(r.changed).toEqual([pid(1)]);
    expect(db.tables.products![0]).toMatchObject({
      is_active: false,
      price: 1000,
      description: "описание 1",
      sort_order: 0,
    });
    expect(db.tables.products![1]!.is_active).toBe(true);
  });

  it("250 товаров: .in кусками по 200, все изменены", async () => {
    const { ctx, db } = setup(250);
    const sizes = spyIn(db);
    const ids = db.tables.products!.map((p) => p.id as string);
    const r = await bulkUpdateProducts(ctx, ids, { kind: "price", percent: 10 });
    expect(r.changed).toHaveLength(250);
    expect(r.skipped).toEqual([]);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(200);
    expect(db.tables.products!.every((p) => p.price === 1100)).toBe(true);
  });

  it("уже так — пропуск с причиной; чужой и несуществующий id — notFound", async () => {
    const { ctx } = setup(2, (i) => ({ is_active: i === 0 }));
    const r = await bulkUpdateProducts(ctx, [pid(1), pid(2), pid(99)], {
      kind: "active",
      active: true,
    });
    expect(r.changed).toEqual([pid(2)]);
    expect(r.skipped).toEqual([
      { id: pid(1), name: "Товар 1", reason: "same" },
      { id: pid(99), name: "", reason: "notFound" },
    ]);
  });

  it("ошибка чтения — ничего не меняется", async () => {
    const { db } = setup(3);
    const broken = { tenant: { id: T, modules: {} }, db: withBrokenReads(db, ["products"]) };
    await expect(
      bulkUpdateProducts(broken as unknown as TenantContext, [pid(1), pid(2)], {
        kind: "active",
        active: false,
      }),
    ).rejects.toThrow();
    expect(db.tables.products!.every((p) => p.is_active === true)).toBe(true);
  });

  it("ошибка чтения вариантов при смене цены — цены не тронуты", async () => {
    const { db } = setup(2);
    const broken = {
      tenant: { id: T, modules: {} },
      db: withBrokenReads(db, ["product_variants"]),
    };
    await expect(
      bulkUpdateProducts(broken as unknown as TenantContext, [pid(1)], {
        kind: "price",
        percent: 10,
      }),
    ).rejects.toThrow();
    expect(db.tables.products!.every((p) => p.price === 1000)).toBe(true);
  });

  it("цена: варианты и цены по странам идут следом, чужие поля не тронуты", async () => {
    const { ctx, db } = setup(1, () => ({ country_prices: { KZ: 1000 } }));
    db.tables.product_variants = [
      { id: "v1", product_id: pid(1), price: 1000, name: "1 кг" },
      { id: "v2", product_id: pid(1), price: 2000, name: "2 кг" },
    ];
    await bulkUpdateProducts(ctx, [pid(1)], { kind: "price", percent: -10 });
    expect(db.tables.products![0]).toMatchObject({
      price: 900,
      country_prices: { KZ: 900 },
      name: "Товар 1",
      description: "описание 1",
    });
    expect(db.tables.product_variants!.map((v) => [v.name, v.price])).toEqual([
      ["1 кг", 900],
      ["2 кг", 1800],
    ]);
  });

  it("цена, ставшая меньше 1, и цена без изменения — пропуск", async () => {
    const { ctx, db } = setup(2, (i) => ({ price: i === 0 ? 1 : 0 }));
    const r = await bulkUpdateProducts(ctx, [pid(1), pid(2)], { kind: "price", percent: -90 });
    expect(r.changed).toEqual([]);
    expect(r.skipped.map((x) => x.reason)).toEqual(["tooLow", "same"]);
    expect(db.tables.products!.map((p) => p.price)).toEqual([1, 0]);
  });

  it("цену успели поменять между чтением и записью — товар не тронут, причина «changed»", async () => {
    const { ctx, db } = setup(1);
    db.tables.product_variants = [{ id: "v1", product_id: pid(1), price: 1000, name: "1 кг" }];
    const from = db.from.bind(db);
    db.from = (table: string) => {
      const q = from(table);
      if (table !== "products") return q;
      const update = q.update.bind(q);
      // Продавец сохраняет карточку с другой ценой уже после нашего чтения.
      q.update = ((patch: Record<string, unknown>) => {
        if ("price" in patch) db.tables.products![0]!.price = 1500;
        return update(patch);
      }) as typeof q.update;
      return q;
    };
    const r = await bulkUpdateProducts(ctx, [pid(1)], { kind: "price", percent: 10 });
    expect(r.changed).toEqual([]);
    expect(r.skipped).toEqual([{ id: pid(1), name: "Товар 1", reason: "changed" }]);
    expect(db.tables.products![0]!.price).toBe(1500);
    expect(db.tables.product_variants![0]!.price).toBe(1000);
  });

  it("категория: добавить не затирает прежние, «только эта» заменяет, без категории очищает", async () => {
    const { ctx, db } = setup(2, (i) => ({ category_ids: i === 0 ? [CAT2] : [CAT] }));
    const add = await bulkUpdateProducts(ctx, [pid(1), pid(2)], {
      kind: "category",
      categoryId: CAT,
      mode: "add",
    });
    expect(add.changed).toEqual([pid(1)]);
    expect(add.skipped).toEqual([{ id: pid(2), name: "Товар 2", reason: "same" }]);
    expect(db.tables.products![0]!.category_ids).toEqual([CAT2, CAT]);
    await bulkUpdateProducts(ctx, [pid(1)], { kind: "category", categoryId: CAT2, mode: "set" });
    expect(db.tables.products![0]!.category_ids).toEqual([CAT2]);
    await bulkUpdateProducts(ctx, [pid(1)], { kind: "category", categoryId: null, mode: "set" });
    expect(db.tables.products![0]!.category_ids).toEqual([]);
  });

  it("несуществующая категория — отказ до записи; больше 500 — отказ", async () => {
    const { ctx, db } = setup(1);
    await expect(
      bulkUpdateProducts(ctx, [pid(1)], {
        kind: "category",
        categoryId: "cccccccc-0000-4000-8000-0000000000ff",
        mode: "add",
      }),
    ).rejects.toMatchObject({ key: "err.catalog.bulkNoCategory" });
    await expect(
      bulkUpdateProducts(
        ctx,
        Array.from({ length: 501 }, (_, i) => pid(i + 1)),
        {
          kind: "active",
          active: false,
        },
      ),
    ).rejects.toMatchObject({ key: "err.catalog.bulkTooMany" });
    expect(db.tables.products![0]!.category_ids).toEqual([]);
  });

  it("процент вне −90…500 — отказ", async () => {
    const { ctx } = setup(1);
    await expect(
      bulkUpdateProducts(ctx, [pid(1)], { kind: "price", percent: -95 }),
    ).rejects.toMatchObject({ key: "err.catalog.bulkPercent" });
  });
});
