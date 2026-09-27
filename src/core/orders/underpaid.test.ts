import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";

const { listOrdersForAdmin, orderCounts, underpaidOrderIds } = await import("./admin");

const BOT = "00000000-0000-0000-0000-0000000000dd";

function shop(rows: Array<Record<string, unknown>>) {
  const db = fakeDb();
  db.tables.orders = rows.map((r, i) => ({
    id: 10 + i,
    bot_id: BOT,
    order_no: 10 + i,
    status: "accepted",
    fulfillment_kind: "physical",
    total: 10000,
    paid_amount: 3000,
    currency: "KZT",
    created_at: new Date(Date.UTC(2026, 8, 1) + i * 60_000).toISOString(),
    order_items: [],
    ...r,
  }));
  const ctx = {
    tenant: { id: BOT, modules: {} },
    db,
    timezone: "Asia/Almaty",
  } as unknown as TenantContext;
  return { ctx, db };
}

describe("«не доплачено»: задаток внесён, остаток нет", () => {
  const rows = [
    {}, // 10: в работе, задаток
    { status: "ready" }, // 11
    { status: "delivered", paid_amount: 9000 }, // 12: выдан, но не доплачен
    { paid_amount: 10000 }, // 13: оплачен полностью
    { paid_amount: 9999.995 }, // 14: копейка округления — оплачен
    { paid_amount: 0 }, // 15: оплата при получении, задатка нет
    { paid_amount: null }, // 16
    { status: "cancelled" }, // 17
    { status: "rejected" }, // 18
    { fulfillment_kind: "digital", paid_amount: 100 }, // 19
    { status: "in_production", paid_amount: "2500.50" }, // 20
  ];

  it("список — только недоплаченные, новые сверху; счётчик — их число", async () => {
    const { ctx } = shop(rows);
    const ids = (await listOrdersForAdmin(ctx, { unpaid: true })).map((o) => o.id);
    expect(ids).toEqual([20, 12, 11, 10]);
    expect((await orderCounts(ctx)).unpaid).toBe(4);
  });

  it("вместе с вкладкой статуса", async () => {
    const { ctx } = shop(rows);
    expect(
      (await listOrdersForAdmin(ctx, { unpaid: true, status: "ready" })).map((o) => o.id),
    ).toEqual([11]);
  });

  it("нет таких — пустой список без запроса «id in ()»", async () => {
    const { ctx } = shop([{ paid_amount: 10000 }]);
    expect(await listOrdersForAdmin(ctx, { unpaid: true })).toEqual([]);
    expect((await orderCounts(ctx)).unpaid).toBe(0);
  });

  it("обход постраничный: больше страницы — считаются все", async () => {
    const many = Array.from({ length: 2500 }, () => ({}));
    const { ctx } = shop(many);
    expect((await underpaidOrderIds(ctx)).length).toBe(2500);
  });
});
