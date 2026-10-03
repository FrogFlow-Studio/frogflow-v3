import { describe, expect, it } from "vitest";
import { computePulse } from "./pulse";

const now = new Date("2026-10-20T12:00:00Z");
const ago = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString();
const base = {
  lastLoginAt: ago(2),
  lastOrderAt: ago(1),
  createdAt: ago(200),
  status: "active",
  now,
};

describe("computePulse", () => {
  it("считает 14 против предыдущих 14 дней и процент", () => {
    const p = computePulse({
      ...base,
      ordersAt: [ago(1), ago(5), ago(15), ago(16), ago(20), ago(27)],
    });
    expect(p.recent).toBe(2);
    expect(p.previous).toBe(4);
    expect(p.changePct).toBe(-50);
    expect(p.ordersDropped).toBe(true);
    expect(p.quiet).toBe(true);
  });
  it("рост — не затих", () => {
    const p = computePulse({ ...base, ordersAt: [ago(1), ago(2), ago(3), ago(20)] });
    expect(p.changePct).toBe(200);
    expect(p.quiet).toBe(false);
    expect(p.risk).toBe(0);
  });
  it("нет входа 14 дней — затих, даже если заказы идут", () => {
    const p = computePulse({ ...base, lastLoginAt: ago(14), ordersAt: [ago(1)] });
    expect(p.noLogin).toBe(true);
    expect(p.quiet).toBe(true);
    expect(computePulse({ ...base, lastLoginAt: ago(13), ordersAt: [ago(1)] }).noLogin).toBe(false);
  });
  it("нет входа, но продавец подтверждает заказы в боте — не затих", () => {
    const p = computePulse({
      ...base,
      lastLoginAt: ago(30),
      lastSellerActionAt: ago(2),
      ordersAt: [ago(1), ago(2), ago(3), ago(20)],
    });
    expect(p.noLogin).toBe(false);
    expect(p.quiet).toBe(false);
    expect(p.risk).toBe(0);
  });
  it("нет входа и последнее действие продавца старше 14 дней — затих", () => {
    const p = computePulse({
      ...base,
      lastLoginAt: ago(30),
      lastSellerActionAt: ago(14),
      ordersAt: [ago(1)],
    });
    expect(p.noLogin).toBe(true);
    expect(p.quiet).toBe(true);
  });
  it("вход не найден в журнале за 90 дней — нет входа", () => {
    const p = computePulse({ ...base, lastLoginAt: null, ordersAt: [] });
    expect(p.daysSinceLogin).toBeNull();
    expect(p.noLogin).toBe(true);
  });
  it("новичок и пауза не считаются затихшими", () => {
    expect(
      computePulse({ ...base, createdAt: ago(5), lastLoginAt: null, ordersAt: [] }).quiet,
    ).toBe(false);
    expect(computePulse({ ...base, status: "paused", lastLoginAt: null, ordersAt: [] }).quiet).toBe(
      false,
    );
  });
  it("прошлых заказов мало — падение не объявляется, процента нет", () => {
    const p = computePulse({ ...base, ordersAt: [ago(20)] });
    expect(p.ordersDropped).toBe(false);
    expect(computePulse({ ...base, ordersAt: [ago(1)] }).changePct).toBeNull();
  });
  it("риск выше у того, кто и упал, и не заходит", () => {
    const both = computePulse({
      ...base,
      lastLoginAt: ago(30),
      ordersAt: [ago(20), ago(21), ago(22), ago(23)],
    });
    const one = computePulse({ ...base, ordersAt: [ago(20), ago(21), ago(22), ago(23)] });
    expect(both.risk).toBeGreaterThan(one.risk);
  });
  it("статистика не прочиталась — давность заказа неизвестна, а не «заказов не было»", () => {
    expect(computePulse({ ...base, lastOrderAt: undefined, ordersAt: [] }).orderKnown).toBe(false);
    const none = computePulse({ ...base, lastOrderAt: null, ordersAt: [] });
    expect(none.orderKnown).toBe(true);
    expect(none.daysSinceOrder).toBeNull();
  });
});
