import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Customer } from "@/core/customers/customers";
import { recentBoughtOrderWith } from "./order-queries";

/** Копилка 14.10: #221 выдан — «Купить» не должен оформить #222. */
const P = "a0000000-0000-4000-8000-000000000001";
const OTHER = "a0000000-0000-4000-8000-000000000002";
const buyer = { telegramId: -42 } as unknown as Customer;

function setup(rows: Array<Record<string, unknown>>) {
  const db = fakeDb();
  db.tables.orders = rows.map((o, i) => ({
    id: 200 + i,
    telegram_id: -42,
    fulfillment_kind: "digital",
    created_at: new Date(Date.now() - 10 * 60_000).toISOString(),
    ...o,
    order_items: [{ id: 1000 + i, order_id: 200 + i, product_id: o.product ?? P }],
  }));
  for (const o of db.tables.orders) delete o.product;
  return { ctx: { db } as unknown as TenantContext, db };
}

describe("recentBoughtOrderWith", () => {
  it("находит свежий выданный и «чек на проверке» заказ этого товара — новый первым", async () => {
    const { ctx } = setup([
      { status: "delivered", created_at: new Date(Date.now() - 60 * 60_000).toISOString() },
      { status: "awaiting_confirmation" },
    ]);
    expect((await recentBoughtOrderWith(ctx, buyer, P))?.id).toBe(201);
  });

  it("не считает: другой товар, ждёт оплаты, отменён, физический, старше трёх дней, чужой", async () => {
    const { ctx } = setup([
      { status: "delivered", product: OTHER },
      { status: "awaiting_payment" },
      { status: "cancelled" },
      { status: "delivered", fulfillment_kind: "physical" },
      { status: "delivered", created_at: new Date(Date.now() - 4 * 86_400_000).toISOString() },
      { status: "delivered", telegram_id: -7 },
    ]);
    expect(await recentBoughtOrderWith(ctx, buyer, P)).toBeNull();
  });

  it("чтение упало — ошибка, а не «заказа нет» (иначе оформится второй)", async () => {
    const ctx = {
      db: {
        from: () => {
          const q: Record<string, unknown> = {};
          for (const m of ["select", "eq", "in", "gte", "order"]) q[m] = () => q;
          q.range = async () => ({ data: null, error: { message: "boom" } });
          return q;
        },
      },
    } as unknown as TenantContext;
    await expect(recentBoughtOrderWith(ctx, buyer, P)).rejects.toThrow();
  });
});
