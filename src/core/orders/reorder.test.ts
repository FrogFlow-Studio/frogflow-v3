import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Customer } from "@/core/customers/customers";
import type { OrderWithItems } from "./orders";
import { reorderReport } from "./orders";
import { lastPaidOrder, shortLabels } from "./reorder";
import { isReorderWord } from "./reorder-words";

/** Б11: «как в прошлый раз» — последний оплаченный заказ, текущие цены и остатки, недостающее названо. */
const BOT = "bot-1";
const me = { userKey: "ig_1", telegramId: -1 } as Customer;

const product = (id: string, stock: number | null = null, active = true) => ({
  id,
  bot_id: BOT,
  is_active: active,
  stock_quantity: stock,
  fulfillment_kind: "digital",
  file_path: `${BOT}/${id}.pdf`,
  file_url: null,
  file_path_kz: null,
  file_url_kz: null,
  product_material_files: [],
});
const item = (productId: string, name: string, quantity: number) => ({
  id: `i-${productId}`,
  order_id: 1,
  product_id: productId,
  product_variant_id: null,
  name_snapshot: name,
  quantity,
  price_snapshot: 100, // старая цена в заказе: в корзину она не переносится
});

function setup(orders: Array<Record<string, unknown>>) {
  const db = fakeDb();
  db.tables.orders = orders;
  db.tables.products = [product("a"), product("b", 1), product("c", null, false)];
  db.tables.cart_items = [];
  db.tables.product_variants = [];
  const ctx = {
    tenant: { id: BOT, modules: { stock: true }, settings: {} },
    db,
  } as unknown as TenantContext;
  return { db, ctx };
}

const order = (id: number, status: string, over: Record<string, unknown> = {}) => ({
  id,
  bot_id: BOT,
  telegram_id: -1,
  status,
  created_at: `2026-09-${10 + id}T10:00:00Z`,
  order_items: [item("a", "Гайд", 1)],
  ...over,
});

describe("последний оплаченный заказ", () => {
  it("берёт самый новый оплаченный; отклонённый, отменённый, неоплаченный и чужой не считаются", async () => {
    const { ctx } = setup([
      order(1, "delivered"),
      order(2, "rejected"),
      order(3, "cancelled"),
      order(4, "awaiting_payment"),
      order(5, "paid", { telegram_id: -2 }),
    ]);
    expect((await lastPaidOrder(ctx, me))?.id).toBe(1);
  });

  it("при равном времени — больший id; нет оплаченных — null", async () => {
    const same = "2026-09-20T10:00:00Z";
    const a = setup([
      order(7, "paid", { created_at: same }),
      order(8, "completed", { created_at: same }),
    ]);
    expect((await lastPaidOrder(a.ctx, me))?.id).toBe(8);
    const b = setup([order(1, "awaiting_payment")]);
    expect(await lastPaidOrder(b.ctx, me)).toBeNull();
  });

  it("сбой чтения — serverFailure, а не «заказов нет»", async () => {
    const { ctx } = setup([]);
    ctx.db.from = (() => {
      throw new Error("boom");
    }) as never;
    await expect(lastPaidOrder(ctx, me)).rejects.toThrow();
  });
});

describe("повтор заказа по текущим остаткам", () => {
  it("снятый с продажи товар и нехватка остатка названы, остальное в корзине", async () => {
    const { ctx, db } = setup([]);
    const o = {
      ...order(1, "delivered"),
      order_items: [item("a", "Гайд", 1), item("b", "Шаблон", 3), item("c", "Снятое", 1)],
    } as unknown as OrderWithItems;
    const r = await reorderReport(ctx, me, o);
    expect(r.added).toBe(2); // торт и одна копия «Пирожного»: цифровой товар по одной штуке
    expect(shortLabels(r.short)).toEqual(["Шаблон (1/3)", "Снятое"]);
    // Цены в корзине нет: считаются по текущим при показе корзины.
    expect(db.tables.cart_items!.map((c) => [c.product_id, c.quantity])).toEqual([
      ["a", 1],
      ["b", 1],
    ]);
    expect(db.tables.cart_items!.every((c) => !("price" in c) && !("price_snapshot" in c))).toBe(
      true,
    );
  });
});

describe("слова «повторить»", () => {
  it("на четырёх языках целиком; обычная фраза — нет", () => {
    for (const w of ["Повторить", "как в прошлый раз!", "қайталау", "Reorder", "oldingidek"])
      expect(isReorderWord(w)).toBe(true);
    expect(isReorderWord("повторите, пожалуйста, цену")).toBe(false);
    expect(isReorderWord("")).toBe(false);
  });
});
