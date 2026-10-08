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

describe("массовые действия: остаток", () => {
  const withStock = (n: number, patch: (i: number) => Record<string, unknown> = () => ({})) => {
    const t = setup(n, patch);
    t.db.tables.app_settings = [];
    t.ctx = {
      tenant: { id: T, modules: { stock: true }, settings: { served_by: "v2" } },
      db: t.db,
    } as unknown as TenantContext;
    return t;
  };
  const stockOf = (db: FakeDb) => db.tables.products!.map((p) => p.stock_quantity);

  it("«задать»: число записано, отчёт «было → стало», чужие поля на месте", async () => {
    const { ctx, db } = withStock(3, (i) => ({ stock_quantity: i === 2 ? null : i }));
    const r = await bulkUpdateProducts(ctx, [pid(1), pid(2), pid(3)], {
      kind: "stock",
      mode: "set",
      amount: 7,
    });
    expect(r.changed).toEqual([pid(1), pid(2), pid(3)]);
    expect(r.stock.map((x) => [x.from, x.to])).toEqual([
      [0, 7],
      [1, 7],
      [null, 7],
    ]);
    expect(stockOf(db)).toEqual([7, 7, 7]);
    expect(db.tables.products![0]).toMatchObject({ price: 1000, description: "описание 1" });
  });

  it("«прибавить»: к текущему; без ведомого остатка — пропуск; то же число — «уже так»", async () => {
    const { ctx, db } = withStock(2, (i) => ({ stock_quantity: i === 0 ? 4 : null }));
    const r = await bulkUpdateProducts(ctx, [pid(1), pid(2)], {
      kind: "stock",
      mode: "add",
      amount: 6,
    });
    expect(r.changed).toEqual([pid(1)]);
    expect(r.skipped.map((x) => x.reason)).toEqual(["untracked"]);
    expect(stockOf(db)).toEqual([10, null]);
    const same = await bulkUpdateProducts(ctx, [pid(1)], {
      kind: "stock",
      mode: "set",
      amount: 10,
    });
    expect(same.skipped.map((x) => x.reason)).toEqual(["same"]);
  });

  it("цифровой товар пропускается, остаток не появляется", async () => {
    const { ctx, db } = withStock(1, () => ({ fulfillment_kind: "digital" }));
    const r = await bulkUpdateProducts(ctx, [pid(1)], { kind: "stock", mode: "set", amount: 5 });
    expect(r.skipped.map((x) => x.reason)).toEqual(["digital"]);
    expect(stockOf(db)).toEqual([null]);
  });

  it("гонка с заказом: остаток списали после чтения — товар не затёрт", async () => {
    const { ctx, db } = withStock(1, () => ({ stock_quantity: 5 }));
    // Заказ списывает единицу в момент между чтением и записью.
    const from = db.from.bind(db);
    db.from = (table: string) => {
      const q = from(table);
      if (table === "products") {
        const upd = q.update.bind(q);
        q.update = (patch: Record<string, unknown>) => {
          db.tables.products![0]!.stock_quantity = 4;
          return upd(patch);
        };
      }
      return q;
    };
    const r = await bulkUpdateProducts(ctx, [pid(1)], { kind: "stock", mode: "add", amount: 10 });
    expect(r.changed).toEqual([]);
    expect(r.skipped.map((x) => x.reason)).toEqual(["stockChanged"]);
    expect(stockOf(db)).toEqual([4]);
  });

  it("пополнение выше порога снимает отметку «заканчивается», ниже порога — нет", async () => {
    const { ctx, db } = withStock(2, () => ({ stock_quantity: 1 }));
    db.tables.app_settings = [
      { bot_id: T, key: "low_stock_default", value: "3" },
      { bot_id: T, key: `low_stock_sent:${pid(1)}`, value: "1" },
      { bot_id: T, key: `low_stock_sent:${pid(2)}`, value: "1" },
    ];
    await bulkUpdateProducts(ctx, [pid(1)], { kind: "stock", mode: "set", amount: 20 });
    await bulkUpdateProducts(ctx, [pid(2)], { kind: "stock", mode: "add", amount: 1 });
    expect(db.tables.app_settings!.map((r) => r.key)).toEqual([
      "low_stock_default",
      `low_stock_sent:${pid(2)}`,
    ]);
  });

  it("без модуля «Склад» и с дробным или отрицательным числом — отказ до записи", async () => {
    const { ctx, db } = setup(1);
    await expect(
      bulkUpdateProducts(ctx, [pid(1)], { kind: "stock", mode: "set", amount: 5 }),
    ).rejects.toMatchObject({ key: "err.catalog.bulkNoStock" });
    const on = withStock(1, () => ({ stock_quantity: 3 }));
    for (const amount of [-1, 2.5, 1_000_001])
      await expect(
        bulkUpdateProducts(on.ctx, [pid(1)], { kind: "stock", mode: "set", amount }),
      ).rejects.toMatchObject({ key: "err.catalog.bulkStockAmount" });
    await expect(
      bulkUpdateProducts(on.ctx, [pid(1)], { kind: "stock", mode: "add", amount: 0 }),
    ).rejects.toMatchObject({ key: "err.catalog.bulkStockAmount" });
    expect(stockOf(on.db)).toEqual([3]);
    expect(stockOf(db)).toEqual([null]);
  });
});

describe("массовые действия: тема для «Похожих»", () => {
  const kw = (db: FakeDb) => db.tables.products!.map((p) => p.keywords);

  it("добавить: тема дописывается к словам, у кого уже есть — «уже так», чужие поля на месте", async () => {
    const { ctx, db } = setup(3, (i) => ({
      keywords: ["пропись", "линейка #тема: 1 Сентября", ""][i],
    }));
    const r = await bulkUpdateProducts(ctx, [pid(1), pid(2), pid(3)], {
      kind: "topic",
      topic: "1 сентября",
      mode: "add",
    });
    expect(r.changed).toEqual([pid(1), pid(3)]);
    expect(r.skipped.map((x) => x.reason)).toEqual(["same"]);
    expect(kw(db)).toEqual([
      "пропись #тема: 1 сентября",
      "линейка #тема: 1 Сентября",
      "#тема: 1 сентября",
    ]);
    expect(db.tables.products![0]!.description).toBe("описание 1");
  });

  it("убрать: тема уходит, слова и другие темы остаются", async () => {
    const { ctx, db } = setup(1, () => ({ keywords: "пропись #тема: 1 сентября, осень" }));
    await bulkUpdateProducts(ctx, [pid(1)], { kind: "topic", topic: "1 сентября", mode: "remove" });
    expect(kw(db)).toEqual(["пропись #тема: осень"]);
  });

  it("продавец поправил ключевые слова после чтения — товар не затёрт, причина «keywordsChanged»", async () => {
    const { ctx, db } = setup(1, () => ({ keywords: "пропись" }));
    const from = db.from.bind(db);
    db.from = (table: string) => {
      const q = from(table);
      if (table !== "products") return q;
      const update = q.update.bind(q);
      q.update = ((patch: Record<string, unknown>) => {
        if ("keywords" in patch) db.tables.products![0]!.keywords = "пропись, азбука";
        return update(patch);
      }) as typeof q.update;
      return q;
    };
    const r = await bulkUpdateProducts(ctx, [pid(1)], {
      kind: "topic",
      topic: "1 сентября",
      mode: "add",
    });
    expect(r.skipped.map((x) => x.reason)).toEqual(["keywordsChanged"]);
    expect(kw(db)).toEqual(["пропись, азбука"]);
  });

  it("пустая или слишком длинная тема — отказ до записи", async () => {
    const { ctx, db } = setup(1, () => ({ keywords: "пропись" }));
    for (const topic of ["  ", "#", "я".repeat(61)])
      await expect(
        bulkUpdateProducts(ctx, [pid(1)], { kind: "topic", topic, mode: "add" }),
      ).rejects.toMatchObject({ key: "err.catalog.bulkTopic" });
    expect(kw(db)).toEqual(["пропись"]);
  });
});
