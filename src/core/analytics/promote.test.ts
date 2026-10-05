import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import { withBrokenReads } from "../../../tests/broken-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { promoteHints, PROMOTE, type PromoteItem } from "./promote";
import { loadPromoteHints } from "./promote.server";

const item = (over: Partial<PromoteItem> & { id: string }): PromoteItem => ({
  name: `Товар ${over.id}`,
  stock: null,
  rating: null,
  sold: 0,
  ...over,
});

describe("«Что продвигать»: правила подсказок (У4)", () => {
  it("хорошая оценка и мало заказов — в подсказки; мало отзывов, средняя оценка или спрос — нет", () => {
    const r = promoteHints([
      item({ id: "a", rating: { avg: 4.8, count: 5 }, sold: 1 }),
      item({ id: "b", rating: { avg: 4.9, count: 2 }, sold: 0 }), // два отзыва — рано
      item({ id: "c", rating: { avg: 4.2, count: 9 }, sold: 0 }), // оценка не та
      item({ id: "d", rating: { avg: 5, count: 8 }, sold: 40 }), // и так берут
      item({ id: "e", rating: null, sold: 0 }),
      item({ id: "f", rating: { avg: 4.5, count: 3 }, sold: PROMOTE.fewSold }), // границы входят
    ]);
    expect(r.quality.map((x) => x.id)).toEqual(["a", "f"]);
    expect(r.total.quality).toBe(2);
  });

  it("мало на складе при спросе: считается по продажам окна, остаток не ведётся — молчим", () => {
    const r = promoteHints([
      item({ id: "a", stock: 3, sold: 30 }), // 3 из 30 в месяц = 3 дня
      item({ id: "b", stock: 0, sold: 5 }), // закончился при спросе
      item({ id: "c", stock: 500, sold: 30 }), // хватит надолго
      item({ id: "d", stock: 1, sold: 2 }), // спроса нет (меньше трёх штук)
      item({ id: "e", stock: null, sold: 90 }), // остаток не ведётся
      item({ id: "f", stock: 14, sold: 30 }), // ровно 14 дней — граница входит
    ]);
    expect(r.stock.map((x) => [x.id, x.daysLeft])).toEqual([
      ["b", 0],
      ["a", 3],
      ["f", 14],
    ]);
  });

  it("показывается не больше пяти, всего — полное число", () => {
    const many = Array.from({ length: 8 }, (_, i) =>
      item({ id: `p${i}`, rating: { avg: 4.6, count: 4 }, sold: 0 }),
    );
    const r = promoteHints(many);
    expect(r.quality).toHaveLength(PROMOTE.shown);
    expect(r.total.quality).toBe(8);
    // порядок устойчив: одинаковые оценки идут по id
    expect(r.quality.map((x) => x.id)).toEqual(["p0", "p1", "p2", "p3", "p4"]);
  });

  it("нет данных — пустые подсказки", () => {
    expect(promoteHints([])).toEqual({ quality: [], stock: [], total: { quality: 0, stock: 0 } });
  });
});

describe("«Что продвигать»: чтение", () => {
  const BOT = "11111111-1111-1111-1111-111111111111";
  const now = new Date("2026-10-05T10:00:00Z");
  function setup() {
    const db = fakeDb();
    db.tables.products = [
      { id: "p1", bot_id: BOT, name: "Раскраска", stock_quantity: 4, is_active: true },
      { id: "p2", bot_id: BOT, name: "Скрытый", stock_quantity: 0, is_active: false },
    ];
    const o = (id: number, status: string, at: string) => ({
      id,
      bot_id: BOT,
      status,
      fulfillment_kind: "physical",
      created_at: at,
    });
    db.tables.orders = [
      o(1, "delivered", "2026-09-20T10:00:00Z"),
      o(2, "delivered", "2026-09-21T10:00:00Z"),
      o(3, "ready", "2026-09-22T10:00:00Z"),
      o(4, "awaiting_payment", "2026-09-23T10:00:00Z"), // не оплачен
      o(5, "delivered", "2026-07-01T10:00:00Z"), // вне окна
    ];
    const it = (id: string, order_id: number, qty: number) => ({
      id,
      order_id,
      product_id: "p1",
      quantity: qty,
    });
    db.tables.order_items = [
      it("i1", 1, 1),
      it("i2", 2, 1),
      it("i3", 3, 1),
      it("i4", 4, 50),
      it("i5", 5, 50),
    ];
    db.tables.product_reviews = [];
    db.tables.app_settings = [];
    const ctx = {
      tenant: { id: BOT, modules: { stock: true } },
      db,
    } as unknown as TenantContext;
    return { ctx, db };
  }

  it("продажи — только оплаченные заказы окна: подсказка считает три штуки, а не сто три", async () => {
    const { ctx, db } = setup();
    (db.tables.products![0] as { stock_quantity: number }).stock_quantity = 1;
    const r = await loadPromoteHints(ctx, now);
    expect(r.stock).toEqual([{ id: "p1", name: "Раскраска", stock: 1, sold: 3, daysLeft: 10 }]);
    expect(r.quality).toEqual([]);
  });

  it("скрытый товар в подсказки не попадает; без модуля «Склад» остаток не считается", async () => {
    const { ctx, db } = setup();
    (db.tables.products![0] as { stock_quantity: number }).stock_quantity = 1;
    (ctx as unknown as { tenant: { modules: object } }).tenant.modules = {};
    const r = await loadPromoteHints(ctx, now);
    expect(r.stock).toEqual([]);
    expect(JSON.stringify(r)).not.toContain("Скрытый");
  });

  it("сбой чтения — ошибка наружу, а не «подсказок нет»", async () => {
    const { ctx, db } = setup();
    const broken = { ...ctx, db: withBrokenReads(db, ["order_items"]) } as unknown as TenantContext;
    await expect(loadPromoteHints(broken, now)).rejects.toThrow();
    const brokenProducts = {
      ...ctx,
      db: withBrokenReads(db, ["products"]),
    } as unknown as TenantContext;
    await expect(loadPromoteHints(brokenProducts, now)).rejects.toThrow();
  });
});
