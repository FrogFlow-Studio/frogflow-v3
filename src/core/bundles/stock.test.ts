import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Customer } from "@/core/customers/customers";
import { placeOrder, rejectOrder } from "@/core/orders/orders";
import { bundleCapacity, bundleStock } from "./stock";

const BOT = "11111111-1111-1111-1111-111111111111";
const TG = 777;
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const P1 = "11111111-aaaa-4aaa-8aaa-111111111111";
const P2 = "22222222-aaaa-4aaa-8aaa-222222222222";
const P3 = "33333333-aaaa-4aaa-8aaa-333333333333";
const COMPOSITION = JSON.stringify({
  items: [
    { p: P1, q: 2 },
    { p: P2, q: 1 },
  ],
});

function setup(stock: { p1: number | null; p2: number | null } = { p1: 5, p2: 3 }, qty = 1) {
  const db = fakeDb();
  db.rpc = async () => ({ data: true, error: null });
  db.tables.bot_users = [{ telegram_id: TG, user_key: `tg:${TG}`, loyalty_points: 0, state: {} }];
  db.tables.payment_methods = [
    { id: "pm-1", country_code: "KZ", country_name: "Казахстан", is_active: true, sort_order: 1 },
  ];
  db.tables.app_settings = [{ bot_id: BOT, key: `bundle:${B}`, value: COMPOSITION }];
  db.tables.products = [
    { id: B, stock_quantity: null },
    { id: P1, stock_quantity: stock.p1 },
    { id: P2, stock_quantity: stock.p2 },
  ];
  db.tables.cart_items = [
    {
      id: "c-1",
      telegram_id: TG,
      quantity: qty,
      product_variant_id: null,
      created_at: "2026-09-26T00:00:00Z",
      products: {
        id: B,
        name: "Набор",
        price: 1000,
        currency: "KZT",
        fulfillment_kind: "digital",
        file_path: `${BOT}/m.pdf`,
      },
      product_variants: null,
    },
  ];
  const ctx = {
    tenant: { id: BOT, modules: { stock: true, bundles: true }, settings: {} },
    db,
  } as unknown as TenantContext;
  const customer: Customer = {
    userKey: `tg:${TG}`,
    platform: "telegram",
    telegramId: TG,
    username: null,
    firstName: "Аня",
    lastName: null,
    languageCode: "ru",
    contactPhone: null,
    email: null,
    loyaltyPoints: 0,
    state: {},
    zernioConversationId: null,
    zernioAccountId: null,
  };
  return { db, ctx, customer };
}

const stockOf = (db: ReturnType<typeof setup>["db"], id: string) =>
  db.tables.products!.find((p) => p.id === id)!.stock_quantity;
const bundleEvents = (db: ReturnType<typeof setup>["db"]) =>
  (db.tables.zernio_logs ?? []).filter((r) => r.event_type === "stock.bundle");

describe("остаток набора", () => {
  const items = [
    { productId: P1, variantId: null, qty: 2 },
    { productId: P2, variantId: null, qty: 1 },
  ];
  it("минимум по составляющим, целыми наборами", () => {
    expect(
      bundleCapacity(
        items,
        new Map([
          [P1, 5],
          [P2, 3],
        ]),
      ),
    ).toBe(2);
  });
  it("составляющая без учёта не ограничивает; без учёта вообще — предела нет", () => {
    expect(
      bundleCapacity(
        items,
        new Map<string, number | null>([
          [P1, null],
          [P2, 3],
        ]),
      ),
    ).toBe(3);
    expect(
      bundleCapacity(
        items,
        new Map<string, number | null>([
          [P1, null],
          [P2, null],
        ]),
      ),
    ).toBeNull();
  });
  it("удалённая составляющая — ноль наборов", () => {
    expect(bundleCapacity(items, new Map([[P1, 9]]))).toBe(0);
  });
  it("читает остатки из базы", async () => {
    const { ctx } = setup();
    expect(await bundleStock(ctx, items)).toBe(2);
  });
});

describe("заказ набора списывает составляющие", () => {
  it("штуки составляющих × штук в заказе, события stock.bundle, у набора остатка нет", async () => {
    const { db, ctx, customer } = setup({ p1: 10, p2: 5 }, 2);
    const r = await placeOrder(ctx, customer, "KZ", {});
    if (!r.ok) throw new Error(`не оформился: ${r.reason}`);
    expect(stockOf(db, P1)).toBe(6);
    expect(stockOf(db, P2)).toBe(3);
    expect(stockOf(db, B)).toBeNull();
    const ev = bundleEvents(db);
    expect(ev).toHaveLength(2);
    expect(ev[0]!.payload).toMatchObject({ bundle_id: B, order_id: r.order.id, actor: "customer" });
  });

  it("одной составляющей не хватило — заказа нет, ничего не списано", async () => {
    const { db, ctx, customer } = setup({ p1: 5, p2: 1 }, 2);
    const r = await placeOrder(ctx, customer, "KZ", {});
    expect(r).toMatchObject({ ok: false, reason: "out_of_stock" });
    expect(stockOf(db, P1)).toBe(5);
    expect(stockOf(db, P2)).toBe(1);
    expect(bundleEvents(db)).toHaveLength(0);
    expect(db.tables.orders ?? []).toHaveLength(0);
  });

  it("отклонение возвращает составляющие ровно один раз по записанному, не по текущему составу", async () => {
    const { db, ctx, customer } = setup({ p1: 10, p2: 5 }, 2);
    const r = await placeOrder(ctx, customer, "KZ", {});
    if (!r.ok) throw new Error("не оформился");
    // Продавец поменял состав после заказа: возврат идёт по тому, что списано.
    db.tables.app_settings![0]!.value = JSON.stringify({ items: [{ p: P3, q: 9 }] });
    expect(await rejectOrder(ctx, r.order.id, "admin")).toBe(true);
    expect(stockOf(db, P1)).toBe(10);
    expect(stockOf(db, P2)).toBe(5);
    expect(await rejectOrder(ctx, r.order.id, "admin")).toBe(false);
    expect(stockOf(db, P1)).toBe(10);
  });

  it("повторный restoreOrderStock набор второй раз не возвращает", async () => {
    const { db, ctx, customer } = setup({ p1: 10, p2: 5 }, 1);
    const r = await placeOrder(ctx, customer, "KZ", {});
    if (!r.ok) throw new Error("не оформился");
    const { restoreOrderStock } = await import("@/core/fulfillment/fulfillment");
    await restoreOrderStock(ctx, r.order.id, "refund", "admin:ann");
    await restoreOrderStock(ctx, r.order.id, "cancel", "system");
    expect(stockOf(db, P1)).toBe(10);
    expect(stockOf(db, P2)).toBe(5);
  });

  it("заказ набора без событий списания склад не пополняет", async () => {
    const { db, ctx } = setup({ p1: 4, p2: 4 });
    db.tables.orders = [{ id: 50, platform: "telegram", status: "pending" }];
    db.tables.order_items = [{ id: "i1", order_id: 50, product_id: B, quantity: 1 }];
    const { restoreOrderStock } = await import("@/core/fulfillment/fulfillment");
    await restoreOrderStock(ctx, 50, "cancel", "system");
    expect(stockOf(db, P1)).toBe(4);
    expect(stockOf(db, P2)).toBe(4);
  });
});
