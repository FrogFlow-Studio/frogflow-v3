import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { OFFERS_KEY } from "@/core/offers/offers";
import { saleVerdict, saleWindows, sellThrough, type SaleOrder } from "./sales";
import { saleResults } from "./sales.server";

const BOT = "00000000-0000-0000-0000-0000000000e6";
const P1 = "11111111-1111-4111-8111-111111111111";
const P2 = "22222222-2222-4222-8222-222222222222";
const CAT = "cat-cakes";
const NOW = new Date("2026-10-20T12:00:00Z");
// Акция 10–15 октября (5 суток), «до» — 5–10 октября.
const offer = {
  id: "s1",
  product_id: P1,
  percent: 20,
  starts_at: "2026-10-10T00:00:00Z",
  ends_at: "2026-10-15T00:00:00Z",
  limit: null,
};

function shop(offers: unknown[] = [offer]) {
  const db = fakeDb({ maxRows: 1000 });
  db.tables.app_settings = [{ bot_id: BOT, key: OFFERS_KEY, value: JSON.stringify(offers) }];
  db.tables.products = [
    { id: P1, bot_id: BOT, name: "Торт", category_ids: [CAT] },
    { id: P2, bot_id: BOT, name: "Пирожное", category_ids: [CAT] },
    { id: "33333333-3333-4333-8333-333333333333", bot_id: BOT, name: "Чай", category_ids: [] },
  ];
  db.tables.categories = [{ id: CAT, bot_id: BOT, name: "Торты" }];
  const order = (id: number, at: string, status = "delivered", currency = "KZT") => ({
    id,
    bot_id: BOT,
    created_at: at,
    status,
    currency,
    fulfillment_kind: "physical",
  });
  db.tables.orders = [
    order(1, "2026-10-06T10:00:00Z"), // до акции
    order(2, "2026-10-12T10:00:00Z"), // в акцию
    order(3, "2026-10-13T10:00:00Z"), // в акцию
    order(4, "2026-10-14T10:00:00Z", "rejected"), // не считается
    order(5, "2026-10-01T10:00:00Z"), // раньше окна «до»
    order(6, "2026-10-17T10:00:00Z"), // после акции
  ];
  const line = (
    id: string,
    order_id: number,
    product_id: string,
    quantity: number,
    price: number,
  ) => ({
    id,
    bot_id: BOT,
    order_id,
    product_id,
    quantity,
    price_snapshot: price,
  });
  db.tables.order_items = [
    line("l1", 1, P1, 1, 10000),
    line("l2", 2, P1, 3, 8000),
    line("l3", 3, P1, 2, 8000),
    line("l4", 3, "33333333-3333-4333-8333-333333333333", 5, 500), // чужой товар
    line("l5", 4, P1, 9, 8000),
    line("l6", 5, P1, 7, 10000),
    line("l7", 6, P1, 4, 10000),
    line("l8", 2, P2, 1, 5000),
  ];
  const ctx = {
    tenant: { id: BOT, modules: { limited_offers: true } },
    db,
    timezone: "Asia/Almaty",
  } as unknown as TenantContext;
  return { db, ctx };
}

describe("итоги акции", () => {
  it("срок акции против такого же срока до неё, чужие заказы и товары не считаются", async () => {
    const { ctx } = shop();
    const [r] = await saleResults(ctx, NOW);
    expect(r).toMatchObject({ name: "Торт", percent: 20, running: false, verdict: "up" });
    // До: заказ 1 (1 шт., 10 000). В акцию: заказы 2 и 3 (5 шт., 40 000); отклонённый 4,
    // заказ 5 (раньше окна «до») и 6 (после акции) не в счёт.
    expect(r!.before).toEqual({ orders: 1, units: 1, revenue: { KZT: 10000 } });
    expect(r!.during).toEqual({ orders: 2, units: 5, revenue: { KZT: 40000 } });
  });

  it("акция на категорию считает все её товары", async () => {
    const { ctx } = shop([{ ...offer, product_id: "", category_id: CAT }]);
    const [r] = await saleResults(ctx, NOW);
    expect(r!.name).toBe("«Торты»");
    expect(r!.during.units).toBe(6); // 3 + 2 торта и 1 пирожное
    expect(r!.during.orders).toBe(2);
  });

  it("идущая акция: окно «до» равно прошедшему сроку", async () => {
    const { ctx } = shop();
    const mid = new Date("2026-10-12T20:00:00Z"); // прошло 2 суток 20 часов
    const w = saleWindows(offer, mid);
    expect(w.end - w.start).toBe(w.start - w.beforeStart);
    const [r] = await saleResults(ctx, mid);
    expect(r!.running).toBe(true);
    expect(r!.during.units).toBe(3); // только заказ 2 из окна до «сейчас»
  });

  it("акция без модуля, будущая и давно прошедшая в итоги не попадают", async () => {
    const off = shop();
    (off.ctx.tenant.modules as Record<string, boolean>).limited_offers = false;
    expect(await saleResults(off.ctx, NOW)).toEqual([]);
    const { ctx } = shop([
      {
        ...offer,
        id: "future",
        starts_at: "2026-11-01T00:00:00Z",
        ends_at: "2026-11-05T00:00:00Z",
      },
      { ...offer, id: "old", starts_at: "2026-05-01T00:00:00Z", ends_at: "2026-05-05T00:00:00Z" },
    ]);
    expect(await saleResults(ctx, NOW)).toEqual([]);
  });

  it("продажи в разных валютах не складываются", () => {
    const orders = new Map<number, SaleOrder>([
      [1, { id: 1, created_at: "2026-10-11T00:00:00Z", status: "delivered", currency: "KZT" }],
      [2, { id: 2, created_at: "2026-10-11T00:00:00Z", status: "delivered", currency: "USD" }],
    ]);
    const r = sellThrough(
      offer,
      new Set([P1]),
      orders,
      [
        { order_id: 1, product_id: P1, quantity: 1, price_snapshot: 8000 },
        { order_id: 2, product_id: P1, quantity: 1, price_snapshot: 20 },
      ],
      NOW,
    );
    expect(r.during.revenue).toEqual({ KZT: 8000, USD: 20 });
  });

  it("вердикт по штукам: порог 10 %", () => {
    const w = (units: number) => ({ orders: 1, units, revenue: {} });
    expect(saleVerdict(w(0), w(0))).toBe("none");
    expect(saleVerdict(w(3), w(0))).toBe("up");
    expect(saleVerdict(w(12), w(10))).toBe("up");
    expect(saleVerdict(w(11), w(10))).toBe("flat");
    expect(saleVerdict(w(9), w(10))).toBe("flat");
    expect(saleVerdict(w(8), w(10))).toBe("down");
  });
});
