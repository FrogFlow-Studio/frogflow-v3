import { describe, expect, it } from "vitest";
import {
  COMMISSION_FREE_MONTHLY,
  COMMISSION_RATE_PERCENT,
  PLAN_TIERS,
} from "@/core/plans/registry";
import {
  commissionableAmount,
  commissionRate,
  monthCommission,
  type CommissionOrder,
} from "./commission";

/** Комиссия платформы: чистый расчёт, без базы и без сегодняшней даты. */
const web = (total: number, extra: Partial<CommissionOrder> = {}): CommissionOrder => ({
  platform: "web",
  status: "paid",
  total,
  currency: "KZT",
  day: "2027-02-10",
  ...extra,
});
const calc = (
  orders: readonly CommissionOrder[],
  over: Partial<Parameters<typeof monthCommission>[0]> = {},
) =>
  monthCommission({
    month: "2027-02",
    orders,
    plan: "flowers.basic",
    enabled: true,
    ...over,
  });

describe("ставка по тарифу", () => {
  it("10 % Базовый, 5 % Про, 1 % Бизнес — с одной суммы продаж", () => {
    expect(PLAN_TIERS.map((t) => COMMISSION_RATE_PERCENT[t])).toEqual([10, 5, 1]);
    const orders = [web(250_000)];
    expect(calc(orders, { plan: "digital.basic" }).commission).toBe(20_000);
    expect(calc(orders, { plan: "digital.pro" }).commission).toBe(10_000);
    expect(calc(orders, { plan: "digital.business" }).commission).toBe(2_000);
  });
  it("договорной тариф и клиент без плана — без ставки и без комиссии", () => {
    expect(commissionRate("custom")).toBeNull();
    expect(commissionRate(null)).toBeNull();
    const r = calc([web(900_000)], { plan: "custom" });
    expect(r).toMatchObject({ commission: 0, accrues: false, reason: "no_rate", sales: 900_000 });
  });
});

describe("порог", () => {
  it("первые 50 000 ₸ в месяц без комиссии, процент только с превышения", () => {
    expect(COMMISSION_FREE_MONTHLY).toBe(50_000);
    expect(calc([web(50_000)])).toMatchObject({ taxable: 0, commission: 0, accrues: true });
    expect(calc([web(60_000)])).toMatchObject({ taxable: 10_000, commission: 1_000 });
    expect(calc([web(30_000), web(30_000)]).commission).toBe(1_000);
  });
});

describe("что считается продажей", () => {
  it("с витрины и маркета (web) — с комиссией; из ботов, Mini App, Direct и вручную — без", () => {
    // Mini App кладёт корзину в бота, заказ оформляет бот: platform telegram.
    for (const platform of ["telegram", "instagram", "whatsapp", "manual", null])
      expect(commissionableAmount(web(100_000, { platform })), String(platform)).toBe(0);
    expect(commissionableAmount(web(100_000))).toBe(100_000);
    expect(calc([web(100_000, { platform: "telegram" })]).sales).toBe(0);
  });
  it("любое подтверждение оплаты: статус решает, не способ (чек, ApiPay, кнопка продавца)", () => {
    for (const status of ["paid", "delivering", "delivered", "completed"])
      expect(commissionableAmount(web(10_000, { status })), status).toBe(10_000);
  });
  it("неоплаченные, отменённые и возвращённые полностью — не продажа", () => {
    for (const status of [
      "new",
      "pending",
      "awaiting_payment",
      "cancelled",
      "refunded",
      "rejected",
    ])
      expect(commissionableAmount(web(10_000, { status })), status).toBe(0);
  });
  it("физический заказ: внесённый задаток, выданный — не меньше итога", () => {
    const base = { fulfillment_kind: "physical" };
    expect(
      commissionableAmount(web(20_000, { ...base, status: "accepted", paid_amount: 5_000 })),
    ).toBe(5_000);
    expect(
      commissionableAmount(web(20_000, { ...base, status: "delivered", paid_amount: 5_000 })),
    ).toBe(20_000);
  });
  it("не в тенге — не считается", () => {
    expect(commissionableAmount(web(10_000, { currency: "USD" }))).toBe(0);
  });
});

describe("возврат", () => {
  it("уменьшает базу: частичный — на сумму, полный — до нуля, не уходит в минус", () => {
    expect(commissionableAmount(web(100_000), 30_000)).toBe(70_000);
    expect(commissionableAmount(web(100_000), 100_000)).toBe(0);
    expect(commissionableAmount(web(100_000), 150_000)).toBe(0);
    const r = calc([{ ...web(100_000), refunded: 40_000 }]);
    expect(r).toMatchObject({ sales: 60_000, commission: 1_000 });
  });
});

describe("месяц, дата начала и выключатель", () => {
  it("считаются только заказы этого месяца по локальному дню", () => {
    const r = calc([
      web(100_000, { day: "2027-01-31" }),
      web(100_000, { day: "2027-02-01" }),
      web(100_000, { day: "2027-03-01" }),
    ]);
    expect(r).toMatchObject({ sales: 100_000, orders: 1, commission: 5_000 });
  });
  it("без своей даты начало с 1 января: за декабрь комиссии нет, с января — есть", () => {
    const dec = monthCommission({
      month: "2026-12",
      orders: [web(200_000, { day: "2026-12-20" })],
      plan: "flowers.basic",
      enabled: true,
    });
    expect(dec).toMatchObject({ commission: 0, accrues: false });
    const jan = monthCommission({
      month: "2027-01",
      orders: [web(200_000, { day: "2027-01-20" })],
      plan: "flowers.basic",
      enabled: true,
    });
    expect(jan).toMatchObject({ accrues: true, commission: 15_000 });
  });
  it("своя дата клиента: месяц до неё — без комиссии, в месяце начала — только заказы с этой даты", () => {
    const orders = [web(100_000, { day: "2027-03-05" }), web(100_000, { day: "2027-03-20" })];
    const before = calc(orders, { month: "2027-03", start: "2027-04-01" });
    expect(before).toMatchObject({ commission: 0, reason: "before_start", accrues: false });
    const mid = calc(orders, { month: "2027-03", start: "2027-03-10" });
    expect(mid).toMatchObject({ sales: 100_000, orders: 1, commission: 5_000, accrues: true });
  });
  it("выключатель платформы выключен — ноль, продажи видны, причина названа", () => {
    const r = calc([web(300_000)], { enabled: false });
    expect(r).toMatchObject({
      sales: 300_000,
      commission: 0,
      accrues: false,
      reason: "switch_off",
    });
  });
});
