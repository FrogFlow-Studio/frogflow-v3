import { describe, expect, it } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Customer } from "@/core/customers/customers";
import { placeOrder, type FulfillmentInput } from "./orders";

/** Лимит заказов на день и слот: честный отказ второму и гонка двух покупателей на последнее место. */
const BOT = "00000000-0000-0000-0000-00000000000d";

function buyer(n: number): Customer {
  return {
    userKey: `ig_${n}`,
    platform: "instagram",
    telegramId: -n,
    username: `b${n}`,
    firstName: `Покупатель ${n}`,
    lastName: null,
    languageCode: null,
    contactPhone: null,
    email: null,
    loyaltyPoints: 0,
    state: {},
    zernioConversationId: null,
    zernioAccountId: null,
  } as Customer;
}

function setup(settings: Record<string, string>, buyers = 2) {
  const db = fakeDb();
  db.tables.payment_methods = [
    {
      id: "pm",
      bot_id: BOT,
      country_code: "KZ",
      country_name: "Казахстан",
      is_active: true,
      sort_order: 0,
    },
  ];
  db.tables.app_settings = Object.entries(settings).map(([key, value]) => ({
    bot_id: BOT,
    key,
    value,
  }));
  const cake = {
    id: "cake",
    bot_id: BOT,
    name: "Торт",
    price: 1000,
    currency: "KZT",
    country_prices: null,
    is_active: true,
    fulfillment_kind: "physical",
    stock_quantity: 10,
    product_material_files: [],
  };
  db.tables.products = [cake];
  db.tables.bot_users = [];
  db.tables.cart_items = [];
  for (let n = 1; n <= buyers; n++) {
    db.tables.bot_users.push({
      id: `u${n}`,
      bot_id: BOT,
      telegram_id: -n,
      user_key: `ig_${n}`,
      state: {},
    });
    db.tables.cart_items.push({
      id: `ci-${n}`,
      bot_id: BOT,
      telegram_id: -n,
      user_key: `ig_${n}`,
      product_id: "cake",
      product_variant_id: null,
      quantity: 1,
      created_at: "2026-09-26T00:00:00Z",
      products: { ...cake },
      product_variants: null,
    });
  }
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
    tenant: { id: BOT, modules: { stock: true }, settings: {} },
    timezone: "Asia/Almaty",
    db: { from: db.from, rpc } as unknown as FakeDb,
  } as unknown as TenantContext;
  return { db, ctx };
}

const at = (date: string, time?: string): FulfillmentInput => ({
  type: "pickup",
  at: time ? `${date}T${time}` : date,
  address: null,
  note: null,
  zone: null,
});

const SLOTS = "10:00–12:00\n12:00–14:00";
const live = (db: FakeDb) => db.tables.orders!.filter((o) => o.status === "awaiting_payment");

describe("лимит заказов на день", () => {
  it("последнее место берёт один; следующему — честный отказ, лишнего заказа и списания нет", async () => {
    const { db, ctx } = setup({ fulfillment_day_limit: "1" });
    const a = await placeOrder(ctx, buyer(1), "KZ", { fulfillment: at("2026-10-12") });
    expect(a.ok).toBe(true);
    const b = await placeOrder(ctx, buyer(2), "KZ", { fulfillment: at("2026-10-12") });
    expect(b).toEqual({ ok: false, reason: "day_full" });
    expect(live(db)).toHaveLength(1);
    expect(db.tables.products![0]!.stock_quantity).toBe(9);
    // Другой день свободен.
    expect((await placeOrder(ctx, buyer(2), "KZ", { fulfillment: at("2026-10-13") })).ok).toBe(
      true,
    );
  });

  it("два покупателя одновременно на последнее место: проходит один, второй получает отказ", async () => {
    const { db, ctx } = setup({ fulfillment_day_limit: "1" });
    const r = await Promise.all([
      placeOrder(ctx, buyer(1), "KZ", { fulfillment: at("2026-10-12") }),
      placeOrder(ctx, buyer(2), "KZ", { fulfillment: at("2026-10-12") }),
    ]);
    expect(r.filter((x) => x.ok)).toHaveLength(1);
    expect(r.filter((x) => !x.ok)).toEqual([{ ok: false, reason: "day_full" }]);
    expect(live(db)).toHaveLength(1);
    expect(db.tables.products![0]!.stock_quantity).toBe(9);
  });

  it("отклонённый и отменённый заказы место не занимают", async () => {
    const { db, ctx } = setup({ fulfillment_day_limit: "1" });
    const a = await placeOrder(ctx, buyer(1), "KZ", { fulfillment: at("2026-10-12") });
    expect(a.ok).toBe(true);
    db.tables.orders![0]!.status = "rejected";
    expect((await placeOrder(ctx, buyer(2), "KZ", { fulfillment: at("2026-10-12") })).ok).toBe(
      true,
    );
    db.tables.orders![1]!.status = "cancelled";
    expect(db.tables.orders!.filter((o) => o.status === "awaiting_payment")).toHaveLength(0);
  });

  it("без лимита и без даты выдачи заказы не ограничены", async () => {
    const { ctx } = setup({}, 2);
    expect((await placeOrder(ctx, buyer(1), "KZ", { fulfillment: at("2026-10-12") })).ok).toBe(
      true,
    );
    expect((await placeOrder(ctx, buyer(2), "KZ", { fulfillment: at("2026-10-12") })).ok).toBe(
      true,
    );
  });
});

describe("лимит заказов на слот", () => {
  it("слот занят — второму отказ «slot_taken», соседний слот того же дня свободен", async () => {
    const { db, ctx } = setup({ fulfillment_slot_limit: "1", fulfillment_slots: SLOTS });
    expect(
      (await placeOrder(ctx, buyer(1), "KZ", { fulfillment: at("2026-10-12", "10:00") })).ok,
    ).toBe(true);
    expect(
      await placeOrder(ctx, buyer(2), "KZ", { fulfillment: at("2026-10-12", "10:00") }),
    ).toEqual({
      ok: false,
      reason: "slot_taken",
    });
    expect(
      (await placeOrder(ctx, buyer(2), "KZ", { fulfillment: at("2026-10-12", "12:00") })).ok,
    ).toBe(true);
    expect(live(db)).toHaveLength(2);
  });

  it("гонка на последнее место в слоте: проходит один", async () => {
    const { db, ctx } = setup({ fulfillment_slot_limit: "1", fulfillment_slots: SLOTS });
    const r = await Promise.all([
      placeOrder(ctx, buyer(1), "KZ", { fulfillment: at("2026-10-12", "12:00") }),
      placeOrder(ctx, buyer(2), "KZ", { fulfillment: at("2026-10-12", "12:00") }),
    ]);
    expect(r.filter((x) => x.ok)).toHaveLength(1);
    expect(r.filter((x) => !x.ok)).toEqual([{ ok: false, reason: "slot_taken" }]);
    expect(live(db)).toHaveLength(1);
    expect(db.tables.products![0]!.stock_quantity).toBe(9);
  });

  it("лимит на день и на слот вместе: сначала сказывается день", async () => {
    const { ctx } = setup(
      {
        fulfillment_day_limit: "2",
        fulfillment_slot_limit: "2",
        fulfillment_slots: SLOTS,
      },
      3,
    );
    expect(
      (await placeOrder(ctx, buyer(1), "KZ", { fulfillment: at("2026-10-12", "10:00") })).ok,
    ).toBe(true);
    expect(
      (await placeOrder(ctx, buyer(2), "KZ", { fulfillment: at("2026-10-12", "12:00") })).ok,
    ).toBe(true);
    expect(
      await placeOrder(ctx, buyer(3), "KZ", { fulfillment: at("2026-10-12", "12:00") }),
    ).toEqual({
      ok: false,
      reason: "day_full",
    });
  });
});

describe("сбой удаления лишнего заказа", () => {
  /** Как setup, но delete по orders отвечает ошибкой (и update тоже, если failCancel). */
  function broken(failCancel: boolean, failItems = false) {
    const { db, ctx } = setup({ fulfillment_day_limit: "1" });
    const real = ctx.db.from;
    const from = (t: string) => {
      const b = (real as (t: string) => unknown)(t) as Record<string, unknown>;
      if (t === "order_items" && failItems)
        return { insert: async () => ({ error: { message: "boom" } }) };
      if (t !== "orders") return b;
      return new Proxy(b, {
        get(target, p) {
          if (p === "delete") return () => ({ eq: async () => ({ error: { message: "boom" } }) });
          if (p === "update" && failCancel)
            return () => ({ eq: () => ({ eq: async () => ({ error: { message: "boom" } }) }) });
          const v = target[p as string];
          return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(target) : v;
        },
      });
    };
    return { db, ctx: { ...ctx, db: { ...ctx.db, from } } as unknown as TenantContext };
  }

  it("удалить не вышло — заказ отменён, а не висит пустым в ожидании; покупателю честный отказ", async () => {
    const { db, ctx } = broken(false);
    expect((await placeOrder(ctx, buyer(1), "KZ", { fulfillment: at("2026-10-12") })).ok).toBe(
      true,
    );
    const b = await placeOrder(ctx, buyer(2), "KZ", { fulfillment: at("2026-10-12") });
    expect(b).toEqual({ ok: false, reason: "day_full" });
    expect(live(db)).toHaveLength(1);
    expect(db.tables.orders!.find((o) => o.status === "cancelled")).toBeTruthy();
    expect(db.tables.products![0]!.stock_quantity).toBe(9);
  });

  it("не удалился и не отменился — serverFailure, а не «занято»", async () => {
    const { ctx } = broken(true);
    expect((await placeOrder(ctx, buyer(1), "KZ", { fulfillment: at("2026-10-12") })).ok).toBe(
      true,
    );
    await expect(
      placeOrder(ctx, buyer(2), "KZ", { fulfillment: at("2026-10-12") }),
    ).rejects.toThrow(/не удалён и не отменён/);
  });

  it("позиции не записались и удалить заказ не вышло — он отменён, а не висит пустым в ожидании", async () => {
    const { db, ctx } = broken(false, true);
    const r = await placeOrder(ctx, buyer(1), "KZ", { fulfillment: at("2026-10-12") });
    expect(r).toEqual({ ok: false, reason: "order_failed" });
    expect(live(db)).toHaveLength(0);
    expect(db.tables.orders!.map((o) => o.status)).toEqual(["cancelled"]);
  });
});
