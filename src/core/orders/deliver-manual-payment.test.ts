import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { deliverOrder } from "./orders";

const BOT = "00000000-0000-0000-0000-000000000001";

function setup(order: Record<string, unknown>) {
  const db = fakeDb();
  db.tables.orders = [
    {
      id: 9,
      bot_id: BOT,
      platform: "instagram",
      telegram_id: -1,
      total: 1700,
      paid_amount: 0,
      currency: "KZT",
      fulfillment_kind: "digital",
      points_earned: 0,
      payment_proof_hash: "h-1",
      ...order,
    },
  ];
  db.tables.order_items = [
    {
      id: "it-1",
      order_id: 9,
      product_id: null,
      name_snapshot: "Палитра",
      material_files_by_lang: {
        ru: [{ path: null, name: null, url: "https://example.com/p.pdf" }],
      },
      delivered_language: null,
    },
  ];
  db.tables.referrals = [];
  db.tables.zernio_logs = [];
  const ctx = { tenant: { id: BOT, modules: {}, settings: {} }, db } as unknown as TenantContext;
  const payments = () =>
    db.tables.zernio_logs!.filter((l) => l.event_type === "order.payment").map((l) => l.payload);
  return { db, ctx, payments };
}

const send = async () => "sent" as const;

describe("ручное подтверждение чека записывает сумму оплаты (выручка не 0)", () => {
  it("продавец подтвердил чек — paid_amount = сумма заказа, в журнале платёж с суммой и чеком", async () => {
    const { db, ctx, payments } = setup({ status: "awaiting_confirmation" });
    const r = await deliverOrder(ctx, 9, send, { actor: "admin" });
    expect(r).toMatchObject({ ok: true, failed: 0 });
    expect(db.tables.orders![0]).toMatchObject({ status: "delivered", paid_amount: 1700 });
    expect(payments()).toEqual([
      expect.objectContaining({
        amount: 1700,
        currency: "KZT",
        source: "manual",
        ref: "h-1",
        actor: "admin",
      }),
    ]);
  });

  it("часть уже внесена — записывается остаток", async () => {
    const { db, ctx, payments } = setup({ status: "awaiting_confirmation", paid_amount: 700 });
    await deliverOrder(ctx, 9, send, { actor: "admin" });
    expect(db.tables.orders![0]!.paid_amount).toBe(1700);
    expect(payments()).toEqual([expect.objectContaining({ amount: 1000 })]);
  });

  it("оплачено шлюзом (сумма уже есть) или выдал бот — второго платежа нет", async () => {
    const paid = setup({ status: "paid", paid_amount: 1700 });
    await deliverOrder(paid.ctx, 9, send, { actor: "admin" });
    expect(paid.payments()).toEqual([]);

    const bot = setup({ status: "awaiting_confirmation" });
    await deliverOrder(bot.ctx, 9, send);
    expect(bot.db.tables.orders![0]!.paid_amount).toBe(0);
    expect(bot.payments()).toEqual([]);
  });

  it("повторная выдача уже выданного — ничего не пишет", async () => {
    const { ctx, payments } = setup({ status: "awaiting_confirmation" });
    await deliverOrder(ctx, 9, send, { actor: "admin" });
    await deliverOrder(ctx, 9, send, { actor: "admin" });
    expect(payments()).toHaveLength(1);
  });
});
