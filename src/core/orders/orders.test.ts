import { describe, expect, it } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import { withBrokenReads } from "../../../tests/broken-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Customer } from "@/core/customers/customers";
import { attachPaymentProof, placeOrder, type FulfillmentInput } from "./orders";

/**
 * Денежный путь оформления (перенос tests/direct-purchase.test.ts v1) — на
 * базе в памяти. Захват оформления в живой базе делает RPC
 * claim_order_placement одним оператором; здесь он повторён синхронно, чтобы
 * проверить, что placeOrder этот захват соблюдает, а не саму SQL-функцию.
 */

const BOT = "00000000-0000-0000-0000-00000000000d";
const TELEGRAM_ID = -424242;
const USER_KEY = "ig_424242";

type Setup = {
  modules?: Record<string, boolean>;
  products?: Array<Record<string, unknown>>;
  cart?: Array<{ product: string; variant?: { id: string; name: string; price: number } }>;
  state?: Record<string, unknown>;
};

function product(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    bot_id: BOT,
    name: `Товар ${id}`,
    price: 1000,
    currency: "KZT",
    country_prices: null,
    is_active: true,
    fulfillment_kind: "physical",
    stock_quantity: null,
    product_material_files: [],
    ...extra,
  };
}

function setup(o: Setup = {}) {
  const db = fakeDb();
  db.tables.payment_methods = [
    {
      id: "pm-kz",
      bot_id: BOT,
      country_code: "KZ",
      country_name: "Казахстан",
      is_active: true,
      sort_order: 0,
    },
  ];
  db.tables.bot_users = [
    { id: "u1", bot_id: BOT, telegram_id: TELEGRAM_ID, user_key: USER_KEY, state: o.state ?? {} },
  ];
  db.tables.products = (o.products ?? []).map((p) => ({ ...p }));
  db.tables.cart_items = (o.cart ?? []).map((line, i) => ({
    id: `ci-${i}`,
    bot_id: BOT,
    telegram_id: TELEGRAM_ID,
    user_key: USER_KEY,
    product_id: line.product,
    product_variant_id: line.variant?.id ?? null,
    quantity: 1,
    created_at: `2026-09-26T00:00:0${i}Z`,
    // Встроенный join PostgREST: строка корзины приходит вместе с товаром.
    products: { ...db.tables.products!.find((p) => p.id === line.product)! },
    product_variants: line.variant ?? null,
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
    tenant: { id: BOT, modules: o.modules ?? {}, settings: {} },
    db: { from: db.from, rpc } as unknown as FakeDb,
  } as unknown as TenantContext;
  const customer: Customer = {
    userKey: USER_KEY,
    platform: "instagram",
    telegramId: TELEGRAM_ID,
    username: "buyer",
    firstName: "Тестовый покупатель",
    lastName: null,
    languageCode: null,
    contactPhone: null,
    email: null,
    loyaltyPoints: 0,
    state: (o.state ?? {}) as Customer["state"],
    zernioConversationId: null,
    zernioAccountId: null,
  };
  const stock = (id: string) => db.tables.products!.find((p) => p.id === id)!.stock_quantity;
  const userState = () => db.tables.bot_users![0]!.state as Record<string, unknown>;
  return { db, ctx, customer, stock, userState };
}

const delivery: FulfillmentInput = {
  type: "delivery",
  at: "2026-09-10",
  address: "ул. Тестовая, 1",
  note: "надпись «С днём рождения»",
  zone: null,
};

describe("placeOrder: захват оформления", () => {
  it("оформление захватывает шаг, создаёт заказ и отпускает захват", async () => {
    const { db, ctx, customer, userState } = setup({
      products: [product("p1")],
      cart: [{ product: "p1" }],
    });
    const r = await placeOrder(ctx, customer, "KZ");
    expect(r.ok).toBe(true);
    expect(db.tables.orders).toHaveLength(1);
    expect(db.tables.cart_items).toHaveLength(0);
    // Следующее «Оформить» не должно упереться в брошенный захват.
    expect(userState().placing_order).toBeUndefined();
  });

  it("второй раз захватить не даёт — оформление уже идёт, заказ не создаётся", async () => {
    const { db, ctx, customer } = setup({
      products: [product("p1")],
      cart: [{ product: "p1" }],
      state: { placing_order: true },
    });
    expect(await placeOrder(ctx, customer, "KZ")).toEqual({ ok: false, reason: "busy" });
    expect(db.tables.orders ?? []).toHaveLength(0);
    expect(db.tables.cart_items).toHaveLength(1);
  });

  it("из двух одновременных оформлений заказ создаёт ровно одно", async () => {
    const { db, ctx, customer } = setup({
      products: [product("p1")],
      cart: [{ product: "p1" }],
    });
    const [a, b] = await Promise.all([
      placeOrder(ctx, customer, "KZ"),
      placeOrder(ctx, customer, "KZ"),
    ]);
    expect([a, b].filter((r) => r.ok)).toHaveLength(1);
    expect([a, b].filter((r) => !r.ok)).toEqual([{ ok: false, reason: "busy" }]);
    // Корзина не дублируется в двух заказах сразу — ради этого захват и есть.
    expect(db.tables.orders).toHaveLength(1);
    expect(db.tables.order_items).toHaveLength(1);
  });
});

describe("placeOrder: состав и получение", () => {
  it("на пустой корзине заказ не создаёт", async () => {
    const { db, ctx, customer, userState } = setup();
    expect(await placeOrder(ctx, customer, "KZ")).toEqual({ ok: false, reason: "empty_cart" });
    expect(db.tables.orders ?? []).toHaveLength(0);
    expect(userState().placing_order).toBeUndefined();
  });

  it("физический заказ записывает способ, дату, адрес и комментарий получения", async () => {
    const { db, ctx, customer } = setup({
      products: [product("cake")],
      cart: [{ product: "cake" }],
    });
    const r = await placeOrder(ctx, customer, "KZ", { fulfillment: delivery });
    expect(r.ok).toBe(true);
    expect(db.tables.orders![0]).toMatchObject({
      fulfillment_kind: "physical",
      fulfillment_type: "delivery",
      fulfillment_address: "ул. Тестовая, 1",
      fulfillment_note: "надпись «С днём рождения»",
    });
    expect(String(db.tables.orders![0]!.fulfillment_at).slice(0, 10)).toBe("2026-09-10");
  });

  it("физический заказ без данных получения — поля получения остаются пустыми", async () => {
    const { db, ctx, customer } = setup({
      products: [product("cake")],
      cart: [{ product: "cake" }],
    });
    const r = await placeOrder(ctx, customer, "KZ");
    expect(r.ok).toBe(true);
    expect(db.tables.orders![0]).toMatchObject({
      fulfillment_kind: "physical",
      fulfillment_type: null,
      fulfillment_at: null,
      fulfillment_address: null,
      fulfillment_note: null,
    });
  });

  it("товар с двумя вариантами — две строки заказа, у каждой свой вариант и его цена", async () => {
    const small = { id: "v-small", name: "1 кг", price: 1000 };
    const big = { id: "v-big", name: "2 кг", price: 1800 };
    const { db, ctx, customer } = setup({
      products: [product("cake", { name: "Торт", price: 500 })],
      cart: [
        { product: "cake", variant: small },
        { product: "cake", variant: big },
      ],
    });
    const r = await placeOrder(ctx, customer, "KZ");
    expect(r.ok).toBe(true);
    const items = [...db.tables.order_items!].sort(
      (a, b) => Number(a.price_snapshot) - Number(b.price_snapshot),
    );
    // Цена варианта, а не служебная «цена от» товара.
    expect(items).toEqual([
      expect.objectContaining({
        product_variant_id: "v-small",
        name_snapshot: "Торт (1 кг)",
        price_snapshot: 1000,
        quantity: 1,
      }),
      expect.objectContaining({
        product_variant_id: "v-big",
        name_snapshot: "Торт (2 кг)",
        price_snapshot: 1800,
        quantity: 1,
      }),
    ]);
    expect(db.tables.orders![0]!.total).toBe(2800);
  });
});

describe("placeOrder: складской учёт", () => {
  it("успешное оформление списывает остаток", async () => {
    const { ctx, customer, stock } = setup({
      modules: { stock: true },
      products: [product("cake", { stock_quantity: 2 })],
      cart: [{ product: "cake" }],
    });
    expect((await placeOrder(ctx, customer, "KZ")).ok).toBe(true);
    expect(stock("cake")).toBe(1);
  });

  it("недостаточный остаток — заказ не создаётся, остаток не трогается", async () => {
    const { db, ctx, customer, stock } = setup({
      modules: { stock: true },
      products: [product("sold", { stock_quantity: 0 })],
      cart: [{ product: "sold" }],
    });
    expect(await placeOrder(ctx, customer, "KZ")).toEqual({ ok: false, reason: "out_of_stock" });
    expect(db.tables.orders ?? []).toHaveLength(0);
    expect(stock("sold")).toBe(0);
  });

  it("раскупленная вторая позиция — остаток уже списанной первой возвращается", async () => {
    const { db, ctx, customer, stock, userState } = setup({
      modules: { stock: true },
      products: [product("cake", { stock_quantity: 2 }), product("sold", { stock_quantity: 0 })],
      cart: [{ product: "cake" }, { product: "sold" }],
    });
    expect(await placeOrder(ctx, customer, "KZ")).toEqual({ ok: false, reason: "out_of_stock" });
    expect(db.tables.orders ?? []).toHaveLength(0);
    expect(stock("cake")).toBe(2);
    expect(stock("sold")).toBe(0);
    expect(userState().placing_order).toBeUndefined();
  });
});

describe("attachPaymentProof", () => {
  it("чек к заказу, который оплаты уже не ждёт, не принимается", async () => {
    const { db, ctx } = setup();
    db.tables.orders = [
      { id: 7, bot_id: BOT, status: "paid", payment_proof_path: null, payment_proof_hash: null },
    ];
    const r = await attachPaymentProof(ctx, 7, {
      bytes: new Uint8Array([1, 2, 3]),
      mime: "image/jpeg",
      ext: "jpg",
    });
    expect(r).toEqual({ ok: false, reason: "closed" });
    expect(db.tables.orders[0]).toMatchObject({ status: "paid", payment_proof_path: null });
  });
});

describe("placeOrder: минимальная сумма заказа", () => {
  const minRow = (value: string) => ({ bot_id: BOT, key: "min_order_amount", value });

  it("корзина меньше минимума — отказ с суммой, заказ не создан, остаток и корзина целы", async () => {
    const { db, ctx, customer, stock, userState } = setup({
      modules: { stock: true },
      products: [product("p1", { stock_quantity: 5 })],
      cart: [{ product: "p1" }],
    });
    db.tables.app_settings = [minRow("2500")];
    expect(await placeOrder(ctx, customer, "KZ")).toEqual({
      ok: false,
      reason: "below_min",
      min: 2500,
      shortfall: 1500,
      currency: "KZT",
    });
    expect(db.tables.orders ?? []).toHaveLength(0);
    expect(db.tables.cart_items).toHaveLength(1);
    expect(stock("p1")).toBe(5);
    expect(userState().placing_order).toBeUndefined();
  });

  it("ровно минимум и выше — заказ оформляется; без настройки и при 0 — тоже", async () => {
    for (const value of ["1000", "999", "0", null]) {
      const { db, ctx, customer } = setup({
        products: [product("p1")],
        cart: [{ product: "p1" }],
      });
      db.tables.app_settings = value === null ? [] : [minRow(value)];
      expect((await placeOrder(ctx, customer, "KZ")).ok).toBe(true);
    }
  });

  it("бесплатный товар минимум не блокирует; счёт продавца (skipMinOrder) — тоже", async () => {
    const free = setup({
      products: [product("gift", { price: 0 })],
      cart: [{ product: "gift" }],
    });
    free.db.tables.app_settings = [minRow("5000")];
    expect((await placeOrder(free.ctx, free.customer, "KZ")).ok).toBe(true);
    const invoice = setup({ products: [product("p1")], cart: [{ product: "p1" }] });
    invoice.db.tables.app_settings = [minRow("5000")];
    expect((await placeOrder(invoice.ctx, invoice.customer, "KZ", { skipMinOrder: true })).ok).toBe(
      true,
    );
  });

  it("минимум считается по сумме корзины, а не по одной позиции", async () => {
    const { db, ctx, customer } = setup({
      products: [product("a"), product("b")],
      cart: [{ product: "a" }, { product: "b" }],
    });
    db.tables.app_settings = [minRow("2000")];
    expect((await placeOrder(ctx, customer, "KZ")).ok).toBe(true);
  });

  it("ошибка чтения настройки — отказ, а не «минимума нет»", async () => {
    const { db, ctx, customer } = setup({ products: [product("p1")], cart: [{ product: "p1" }] });
    const broken = withBrokenReads(db, ["app_settings"]);
    (ctx as unknown as { db: unknown }).db = {
      from: broken.from,
      rpc: (ctx.db as unknown as { rpc: unknown }).rpc,
    };
    await expect(placeOrder(ctx, customer, "KZ")).rejects.toThrow();
    expect(db.tables.orders ?? []).toHaveLength(0);
  });
});
