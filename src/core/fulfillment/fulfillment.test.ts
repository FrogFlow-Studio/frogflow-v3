import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import {
  activeDeliveryZones,
  amountDueNow,
  fulfillmentSettings,
  recordPayment,
} from "./fulfillment";

const BOT = "00000000-0000-0000-0000-000000000001";

function setup(settings: Record<string, string> = {}) {
  const db = fakeDb();
  db.tables.app_settings = Object.entries(settings).map(([key, value]) => ({
    bot_id: BOT,
    key,
    value,
  }));
  const ctx = { tenant: { id: BOT, modules: {} }, db } as unknown as TenantContext;
  return { db, ctx };
}

describe("activeDeliveryZones", () => {
  it("activeDeliveryZones возвращает зоны по sort_order, скрытые (is_active=false) не попадают", async () => {
    const { db, ctx } = setup();
    db.tables.delivery_zones = [
      { id: "z-south", name: "Юг", price: 3000, sort_order: 2, is_active: true },
      { id: "z-center", name: "Центр", price: 2000, sort_order: 1, is_active: true },
      { id: "z-hidden", name: "Скрытая", price: 5000, sort_order: 0, is_active: false },
    ];
    expect(await activeDeliveryZones(ctx)).toEqual([
      { id: "z-center", name: "Центр", price: 2000 },
      { id: "z-south", name: "Юг", price: 3000 },
    ]);
  });

  it("activeDeliveryZones — пустой список, если у арендатора нет ни одной зоны (фолбэк на свободный адрес)", async () => {
    const { ctx } = setup();
    expect(await activeDeliveryZones(ctx)).toEqual([]);
  });
});

describe("fulfillmentSettings — способы получения и режим оплаты", () => {
  it("оба способа включены по умолчанию, пока ничего не настроено", async () => {
    const { ctx } = setup();
    expect(await fulfillmentSettings(ctx)).toMatchObject({ pickup: true, delivery: true });
  });

  it("самовывоз выключен явной настройкой — доставка остаётся включённой", async () => {
    const { ctx } = setup({ fulfillment_pickup_enabled: "false" });
    expect(await fulfillmentSettings(ctx)).toMatchObject({ pickup: false, delivery: true });
  });
});

describe("amountDueNow — сколько просить сейчас", () => {
  const physical = { total: 15000, fulfillment_kind: "physical" };

  it("digital-заказ — всегда полная сумма, режим оплаты не смотрится вовсе", async () => {
    const { ctx } = setup({ payment_mode: "deposit", deposit_percent: "40" });
    expect(await amountDueNow(ctx, { total: 15000, fulfillment_kind: "digital" })).toBe(15000);
  });

  it("payment_mode не настроен — full по умолчанию, вся сумма", async () => {
    const { ctx } = setup();
    expect((await fulfillmentSettings(ctx)).paymentMode).toBe("full");
    expect(await amountDueNow(ctx, physical)).toBe(15000);
  });

  it("full, on_receipt и deposit по проценту", async () => {
    expect(await amountDueNow(setup({ payment_mode: "full" }).ctx, physical)).toBe(15000);
    expect(await amountDueNow(setup({ payment_mode: "on_receipt" }).ctx, physical)).toBe(0);
    const deposit = setup({ payment_mode: "deposit", deposit_percent: "40" }).ctx;
    expect(await amountDueNow(deposit, physical)).toBe(6000);
  });

  it("deposit с пустым deposit_percent — откатывается на 30%, не на 0₸", async () => {
    const { ctx } = setup({ payment_mode: "deposit", deposit_percent: "" });
    expect(await amountDueNow(ctx, physical)).toBe(4500);
  });

  it("deposit с мусорным deposit_percent (NaN) — откатывается на 30%, не на NaN₸", async () => {
    const { ctx } = setup({ payment_mode: "deposit", deposit_percent: "abc" });
    expect((await fulfillmentSettings(ctx)).depositPercent).toBe(30);
    expect(await amountDueNow(ctx, physical)).toBe(4500);
  });

  it("deposit с deposit_percent вне диапазона (150) — тоже клэмп на 30%", async () => {
    const { ctx } = setup({ payment_mode: "deposit", deposit_percent: "150" });
    expect((await fulfillmentSettings(ctx)).depositPercent).toBe(30);
    expect(await amountDueNow(ctx, physical)).toBe(4500);
  });
});

describe("recordPayment — «Внести оплату»", () => {
  function withOrder(total: number, paid = 0) {
    const s = setup();
    s.db.tables.orders = [{ id: 1, bot_id: BOT, total, paid_amount: paid, status: "accepted" }];
    return s;
  }

  it("recordPayment суммирует внесённое (задаток + остаток)", async () => {
    const { db, ctx } = withOrder(15000);
    expect(await recordPayment(ctx, 1, 5000)).toBe(true);
    expect(await recordPayment(ctx, 1, 10000)).toBe(true);
    expect(db.tables.orders![0]!.paid_amount).toBe(15000);
  });

  it("два одновременных платежа не теряют друг друга (CAS по старому значению)", async () => {
    const { db, ctx } = withOrder(15000);
    const r = await Promise.all([recordPayment(ctx, 1, 5000), recordPayment(ctx, 1, 4000)]);
    expect(r).toEqual([true, true]);
    expect(db.tables.orders![0]!.paid_amount).toBe(9000);
  });

  it("не поднимает paid_amount выше total", async () => {
    const { db, ctx } = withOrder(15000);
    await recordPayment(ctx, 1, 20000);
    expect(db.tables.orders![0]!.paid_amount).toBe(15000);
  });

  it("ноль, минус и NaN не пишутся", async () => {
    const { db, ctx } = withOrder(15000);
    for (const bad of [0, -100, Number.NaN]) expect(await recordPayment(ctx, 1, bad)).toBe(false);
    expect(db.tables.orders![0]!.paid_amount).toBe(0);
  });
});
