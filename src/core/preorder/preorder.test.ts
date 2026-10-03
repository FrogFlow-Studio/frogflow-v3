import { describe, expect, it } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Customer } from "@/core/customers/customers";
import { addToCart } from "@/core/cart/cart";
import { restoreOrderStock } from "@/core/fulfillment/fulfillment";
import { placeOrder } from "@/core/orders/orders";
import {
  activePreorder,
  getPreorder,
  getPreorderRaw,
  preorderDatePast,
  todayInZone,
  parsePreorder,
  preorderKey,
  preordersFor,
  savePreorder,
} from "./preorder";

const BOT = "00000000-0000-0000-0000-0000000000ee";
const TG = -515151;
const KEY = "ig_515151";

const product = (id: string, stock: number | null) => ({
  id,
  bot_id: BOT,
  name: `Товар ${id}`,
  price: 1000,
  currency: "KZT",
  country_prices: null,
  is_active: true,
  fulfillment_kind: "physical",
  stock_quantity: stock,
  product_material_files: [],
});

function setup(
  products: Array<ReturnType<typeof product>>,
  cart: Array<{ product: string; qty: number }>,
  preorders: Record<string, string> = {},
  modules: Record<string, boolean> = { stock: true },
) {
  const db = fakeDb();
  db.tables.payment_methods = [
    {
      id: "pm",
      bot_id: BOT,
      country_code: "KZ",
      country_name: "К",
      is_active: true,
      sort_order: 0,
    },
  ];
  db.tables.bot_users = [{ id: "u1", bot_id: BOT, telegram_id: TG, user_key: KEY, state: {} }];
  db.tables.products = products.map((p) => ({ ...p }));
  db.tables.app_settings = Object.entries(preorders).map(([id, value]) => ({
    bot_id: BOT,
    key: preorderKey(id),
    value,
  }));
  db.tables.cart_items = cart.map((l, i) => ({
    id: `ci-${i}`,
    bot_id: BOT,
    telegram_id: TG,
    user_key: KEY,
    product_id: l.product,
    product_variant_id: null,
    quantity: l.qty,
    created_at: `2026-10-03T00:00:0${i}Z`,
    products: { ...db.tables.products!.find((p) => p.id === l.product)! },
    product_variants: null,
  }));
  const rpc = async (name: string, args: Record<string, unknown>) => {
    await Promise.resolve();
    if (name !== "claim_order_placement") return db.rpc(name, args);
    const user = db.tables.bot_users!.find((u) => u.telegram_id === args.p_telegram_id);
    const state = (user?.state ?? {}) as Record<string, unknown>;
    if (!user || state.placing_order === true) return { data: false, error: null };
    user.state = { ...state, placing_order: true };
    return { data: true, error: null };
  };
  const ctx = {
    tenant: { id: BOT, modules, settings: {} },
    db: { from: db.from, rpc } as unknown as FakeDb,
  } as unknown as TenantContext;
  const customer = {
    userKey: KEY,
    platform: "instagram",
    telegramId: TG,
    username: "b",
    firstName: "Покупатель",
    lastName: null,
    languageCode: null,
    contactPhone: null,
    email: null,
    loyaltyPoints: 0,
    state: {},
    zernioConversationId: null,
    zernioAccountId: null,
  } as unknown as Customer;
  const stock = (id: string) => db.tables.products!.find((p) => p.id === id)!.stock_quantity;
  return { db, ctx, customer, stock };
}

describe("предзаказ: значения и правила", () => {
  it("дата, «без даты» и пусто разбираются; мусор — предзаказа нет", () => {
    expect(parsePreorder("2099-11-15")).toEqual({ from: "2099-11-15" });
    expect(parsePreorder("-")).toEqual({ from: null });
    expect(parsePreorder("")).toBeNull();
    expect(parsePreorder(null)).toBeNull();
    expect(parsePreorder("завтра")).toBeNull();
    expect(parsePreorder("2026-13-45")).toBeNull();
  });

  it("действует только при модуле «Склад» и пока остатка не хватает", () => {
    const on = { tenant: { modules: { stock: true } } } as unknown as TenantContext;
    const off = { tenant: { modules: {} } } as unknown as TenantContext;
    const flag = { from: null };
    expect(activePreorder(on, { stock_quantity: 0 }, flag)).toBe(flag);
    expect(activePreorder(on, { stock_quantity: 2 }, flag)).toBeNull();
    expect(activePreorder(on, { stock_quantity: 2 }, flag, 3)).toBe(flag);
    expect(activePreorder(on, { stock_quantity: null }, flag)).toBeNull();
    expect(activePreorder(off, { stock_quantity: 0 }, flag)).toBeNull();
    expect(activePreorder(on, { stock_quantity: 0 }, null)).toBeNull();
  });

  it("сохранение: включить, поменять дату, выключить; выключать нечего — строку не плодим", async () => {
    const { db, ctx } = setup([product("a", 0)], []);
    await savePreorder(ctx, "a", { on: false });
    expect(db.tables.app_settings).toHaveLength(0);
    await savePreorder(ctx, "a", { on: true, from: "2099-11-01" });
    expect(await getPreorder(ctx, "a")).toEqual({ from: "2099-11-01" });
    await savePreorder(ctx, "a", { on: true, from: null });
    expect(await getPreorder(ctx, "a")).toEqual({ from: null });
    await savePreorder(ctx, "a", { on: false });
    expect(await getPreorder(ctx, "a")).toBeNull();
  });

  it("список читается кусками: длиннее 200 товаров не ломает адрес запроса", async () => {
    const ids = Array.from({ length: 450 }, (_, i) => `p${i}`);
    const { db, ctx } = setup([], [], { p449: "2099-12-01" });
    db.maxIn = 200;
    expect((await preordersFor(ctx, ids)).get("p449")).toEqual({ from: "2099-12-01" });
  });
});

describe("предзаказ: прошедшая дата отправки", () => {
  const NOW = new Date("2026-10-10T10:00:00Z");

  it("покупатель видит «срок уточним», продавец — свою дату; сегодня и позже — как есть", async () => {
    const { ctx } = setup([], [], { old: "2026-10-01", today: "2026-10-10", next: "2026-10-11" });
    expect(await getPreorder(ctx, "old", NOW)).toEqual({ from: null });
    expect(await getPreorder(ctx, "today", NOW)).toEqual({ from: "2026-10-10" });
    expect(await getPreorder(ctx, "next", NOW)).toEqual({ from: "2026-10-11" });
    expect(await getPreorderRaw(ctx, "old")).toEqual({ from: "2026-10-01" });
    const all = await preordersFor(ctx, ["old", "today", "next"], NOW);
    expect(all.get("old")).toEqual({ from: null });
    expect(all.get("today")).toEqual({ from: "2026-10-10" });
  });

  it("«сегодня» считается в поясе магазина", () => {
    const late = new Date("2026-10-10T20:00:00Z");
    expect(todayInZone("Asia/Almaty", late)).toBe("2026-10-11");
    expect(preorderDatePast({ from: "2026-10-10" }, "Asia/Almaty", late)).toBe(true);
    expect(preorderDatePast({ from: "2026-10-10" }, "UTC", late)).toBe(false);
    expect(preorderDatePast({ from: null }, "UTC", late)).toBe(false);
  });

  it("заказ с прошедшей датой: в событии срок не назван", async () => {
    const { db, ctx, customer } = setup([product("a", 0)], [{ product: "a", qty: 1 }], {
      a: "2020-01-01",
    });
    expect((await placeOrder(ctx, customer, "KZ")).ok).toBe(true);
    const ev = db.tables.zernio_logs!.find((e) => e.event_type === "order.preorder")!;
    expect((ev.payload as { lines: unknown }).lines).toEqual([
      { product_id: "a", quantity: 1, from: null },
    ]);
  });
});

describe("предзаказ: корзина и оформление", () => {
  it("в корзину сверх остатка — только при включённом предзаказе", async () => {
    const off = setup([product("a", 0)], []);
    expect(await addToCart(off.ctx, off.customer, "a")).toBe("out_of_stock");
    const on = setup([product("a", 0)], [], { a: "2099-11-15" });
    expect(await addToCart(on.ctx, on.customer, "a")).toBe("ok");
  });

  it("нет остатка: заказ создан, остаток не ушёл в минус, событие хранит позиции и срок", async () => {
    const { db, ctx, customer, stock } = setup([product("a", 0)], [{ product: "a", qty: 2 }], {
      a: "2099-11-15",
    });
    const r = await placeOrder(ctx, customer, "KZ");
    expect(r.ok).toBe(true);
    expect(stock("a")).toBe(0);
    const ev = db.tables.zernio_logs!.find((e) => e.event_type === "order.preorder")!;
    expect((ev.payload as { lines: unknown }).lines).toEqual([
      { product_id: "a", quantity: 2, from: "2099-11-15" },
    ]);
  });

  it("предзаказ выключен — как раньше: нет остатка, нет заказа", async () => {
    const { db, ctx, customer } = setup([product("a", 0)], [{ product: "a", qty: 1 }]);
    expect(await placeOrder(ctx, customer, "KZ")).toEqual({ ok: false, reason: "out_of_stock" });
    expect(db.tables.orders ?? []).toHaveLength(0);
  });

  it("не хватает части: вся позиция предзаказом, остаток не трогаем; есть остаток — списываем как обычно", async () => {
    const { db, ctx, customer, stock } = setup(
      [product("a", 1), product("b", 5)],
      [
        { product: "a", qty: 3 },
        { product: "b", qty: 2 },
      ],
      { a: "-", b: "2099-11-15" },
    );
    expect((await placeOrder(ctx, customer, "KZ")).ok).toBe(true);
    expect(stock("a")).toBe(1);
    expect(stock("b")).toBe(3);
    const ev = db.tables.zernio_logs!.find((e) => e.event_type === "order.preorder")!;
    expect((ev.payload as { lines: unknown }).lines).toEqual([
      { product_id: "a", quantity: 3, from: null },
    ]);
  });

  it("событие предзаказа не записалось — заказа нет, остаток и корзина прежние", async () => {
    const { db, ctx, customer, stock } = setup(
      [product("a", 0), product("b", 5)],
      [
        { product: "a", qty: 1 },
        { product: "b", qty: 2 },
      ],
      { a: "2099-11-15" },
    );
    const real = ctx.db as unknown as { from: (table: string) => Record<string, unknown> };
    const from = real.from;
    // Журнал не принимает запись предзаказа (остальные события проходят).
    real.from = (table: string) => {
      const q = from(table) as { insert: (row: Record<string, unknown>) => unknown };
      if (table !== "zernio_logs") return q as never;
      const insert = q.insert.bind(q);
      q.insert = (row) =>
        row.event_type === "order.preorder"
          ? Promise.resolve({ data: null, error: { message: "журнал недоступен" } })
          : insert(row);
      return q as never;
    };
    expect(await placeOrder(ctx, customer, "KZ")).toEqual({ ok: false, reason: "order_failed" });
    expect(db.tables.orders ?? []).toHaveLength(0);
    expect(db.tables.order_items ?? []).toHaveLength(0);
    expect(stock("b")).toBe(5);
    expect(stock("a")).toBe(0);
  });

  it("возврат склада: позиции предзаказа не возвращаются, обычные — да", async () => {
    const { db, ctx, customer, stock } = setup(
      [product("a", 0), product("b", 5)],
      [
        { product: "a", qty: 2 },
        { product: "b", qty: 2 },
      ],
      { a: "2099-11-15" },
    );
    const r = await placeOrder(ctx, customer, "KZ");
    if (!r.ok) throw new Error("заказ не создан");
    expect(stock("b")).toBe(3);
    await restoreOrderStock(ctx, r.order.id);
    // Предзаказный товар остался с нулём: на складе не появилось то, чего нет.
    expect(stock("a")).toBe(0);
    expect(stock("b")).toBe(5);
    expect(db.tables.orders).toHaveLength(1);
  });
});
