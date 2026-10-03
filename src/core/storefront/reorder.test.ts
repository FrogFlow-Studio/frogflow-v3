import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { planReorder, planReorderForBuyer } from "./reorder";

const BOT = "00000000-0000-0000-0000-0000000000aa";
const P = (n: number) => `00000000-0000-0000-0000-00000000010${n}`;

function product(n: number, over: Record<string, unknown> = {}) {
  return {
    id: P(n),
    bot_id: BOT,
    name: `Товар ${n}`,
    price: 1000 * n,
    currency: "KZT",
    is_active: true,
    fulfillment_kind: "physical",
    stock_quantity: null,
    category_ids: [],
    product_images: [],
    product_variants: [],
    product_material_files: [],
    ...over,
  };
}

function setup(
  products: Record<string, unknown>[],
  items: Record<string, unknown>[],
  stock = true,
) {
  const db = fakeDb();
  db.tables.products = products;
  db.tables.categories = [];
  db.tables.orders = [
    { id: 7, bot_id: BOT, telegram_id: 111, platform: "telegram", status: "delivered" },
    { id: 8, bot_id: BOT, telegram_id: 900, platform: "web", status: "delivered" },
  ];
  db.tables.order_items = items.map((it, i) => ({ id: `i${i}`, order_id: 7, quantity: 1, ...it }));
  db.tables.bot_users = [
    { bot_id: BOT, telegram_id: 222, user_key: "telegram:222", state: { web_orders: [8] } },
  ];
  db.tables.app_settings = [];
  const ctx = {
    tenant: { id: BOT, modules: { stock }, settings: {} },
    timezone: "Asia/Almaty",
    db,
  } as unknown as TenantContext;
  const order = (id: number) => ({
    order_items: db.tables.order_items!.filter((i) => i.order_id === id) as never,
  });
  return { db, ctx, order };
}

describe("повтор заказа на витрине", () => {
  it("кладёт товары по сегодняшним ценам, снятый и скрытый пропускает с причиной", async () => {
    const { ctx, order } = setup(
      [product(1, { price: 1500 }), product(2, { is_active: false })],
      [
        { product_id: P(1), quantity: 2, name_snapshot: "Товар 1" },
        { product_id: P(2), quantity: 1, name_snapshot: "Снятый" },
        { product_id: null, quantity: 1, name_snapshot: "Подарочный сертификат" },
      ],
    );
    const plan = await planReorder(ctx, order(7));
    expect(plan.lines).toEqual([
      expect.objectContaining({ productId: P(1), qty: 2, price: 1500, kind: "physical" }),
    ]);
    expect(plan.skipped).toEqual([
      { name: "Снятый", reason: "gone" },
      { name: "Подарочный сертификат", reason: "gone" },
    ]);
  });

  it("остаток учтён: нулевой — нет, нехватка — меньше и сказано сколько, остаток делится между вариантами", async () => {
    const { ctx, order } = setup(
      [
        product(1, { stock_quantity: 0 }),
        product(2, { stock_quantity: 3 }),
        product(3, {
          stock_quantity: 4,
          product_variants: [
            { id: "va", name: "S", price: 10, sort_order: 0 },
            { id: "vb", name: "M", price: 20, sort_order: 1 },
          ],
        }),
      ],
      [
        { product_id: P(1), quantity: 1, name_snapshot: "Нет" },
        { product_id: P(2), quantity: 5, name_snapshot: "Мало" },
        { product_id: P(3), product_variant_id: "va", quantity: 3, name_snapshot: "Вар S" },
        { product_id: P(3), product_variant_id: "vb", quantity: 3, name_snapshot: "Вар M" },
      ],
    );
    const plan = await planReorder(ctx, order(7));
    expect(plan.lines.map((l) => [l.productId, l.variantId, l.qty])).toEqual([
      [P(2), null, 3],
      [P(3), "va", 3],
      [P(3), "vb", 1],
    ]);
    expect(plan.skipped).toEqual([
      { name: "Нет", reason: "out_of_stock" },
      { name: "Мало", reason: "less", left: 3 },
      { name: "Вар M", reason: "less", left: 1 },
    ]);
  });

  it("включённый предзаказ: нулевой и недостаточный остаток не мешают, остаток не делится", async () => {
    const { db, ctx, order } = setup(
      [product(1, { stock_quantity: 0 }), product(2, { stock_quantity: 3 })],
      [
        { product_id: P(1), quantity: 2, name_snapshot: "Нет" },
        { product_id: P(2), quantity: 5, name_snapshot: "Мало" },
      ],
    );
    db.tables.app_settings = [
      { bot_id: BOT, key: `preorder:${P(1)}`, value: "2026-11-15" },
      { bot_id: BOT, key: `preorder:${P(2)}`, value: "-" },
    ];
    const plan = await planReorder(ctx, order(7));
    expect(plan.lines.map((l) => [l.productId, l.qty])).toEqual([
      [P(1), 2],
      [P(2), 5],
    ]);
    expect(plan.skipped).toEqual([]);
  });

  it("исчезнувший вариант и «товар обзавёлся вариантами» не подменяются ценой «от»", async () => {
    const { ctx, order } = setup(
      [
        product(1, { product_variants: [{ id: "va", name: "S", price: 10, sort_order: 0 }] }),
        product(2),
      ],
      [
        {
          product_id: P(1),
          product_variant_id: "gone",
          quantity: 1,
          name_snapshot: "Старый вариант",
        },
        { product_id: P(1), product_variant_id: null, quantity: 1, name_snapshot: "Без варианта" },
        { product_id: P(2), product_variant_id: "va", quantity: 1, name_snapshot: "Чужой вариант" },
      ],
    );
    const plan = await planReorder(ctx, order(7));
    expect(plan.lines).toEqual([]);
    expect(plan.skipped.map((s) => s.reason)).toEqual([
      "variant_gone",
      "variant_gone",
      "variant_gone",
    ]);
  });

  it("цифровой товар — одна штука, остаток при выключенном «Складе» не смотрим", async () => {
    const { ctx, order } = setup(
      [product(1, { fulfillment_kind: "digital", file_path: "f.pdf", stock_quantity: 0 })],
      [{ product_id: P(1), quantity: 4, name_snapshot: "Книга" }],
      false,
    );
    const plan = await planReorder(ctx, order(7));
    expect(plan.lines.map((l) => [l.kind, l.qty])).toEqual([["digital", 1]]);
    expect(plan.skipped).toEqual([]);
  });

  it("чужой заказ не открывается: свой — по telegram_id или привязанный с сайта", async () => {
    const { ctx } = setup([product(1)], [{ product_id: P(1), name_snapshot: "Товар 1" }]);
    expect((await planReorderForBuyer(ctx, 111, 7))?.lines).toHaveLength(1);
    expect(await planReorderForBuyer(ctx, 333, 7)).toBeNull();
    expect(await planReorderForBuyer(ctx, 111, 999)).toBeNull();
    // Заказ с сайта виден только тому, кто привязал его по ссылке.
    expect(await planReorderForBuyer(ctx, 222, 8)).not.toBeNull();
    expect(await planReorderForBuyer(ctx, 333, 8)).toBeNull();
    // Привязка не открывает обычный заказ бота.
    expect(await planReorderForBuyer(ctx, 222, 7)).toBeNull();
  });
});
