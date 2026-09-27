import { describe, expect, it } from "vitest";
import { cardBadge, shownLeadDays } from "./lead-time";

describe("срок изготовления товара", () => {
  it("только у физического товара с положительным сроком", () => {
    expect(shownLeadDays({ fulfillment_kind: "physical", lead_time_days: 2 })).toBe(2);
    expect(shownLeadDays({ fulfillment_kind: "physical", lead_time_days: 0 })).toBeNull();
    expect(shownLeadDays({ fulfillment_kind: "physical", lead_time_days: null })).toBeNull();
    expect(shownLeadDays({ fulfillment_kind: "digital", lead_time_days: 5 })).toBeNull();
    expect(shownLeadDays({ fulfillment_kind: null, lead_time_days: 5 })).toBeNull();
  });
});

describe("значок на карточке витрины", () => {
  it("цифровой — «Файл», даже если срок заполнен", () => {
    expect(cardBadge({ kind: "digital", leadTimeDays: 3, inStock: true })).toEqual({
      key: "catalog.file",
    });
  });
  it("физический со сроком — «На заказ · N дн.»", () => {
    expect(cardBadge({ kind: "physical", leadTimeDays: 3, inStock: true })).toEqual({
      key: "catalog.madeToOrder",
      n: 3,
    });
  });
  it("физический без срока и в наличии — «В наличии», как в v1", () => {
    expect(cardBadge({ kind: "physical", leadTimeDays: 0, inStock: true })).toEqual({
      key: "catalog.inStock",
    });
    expect(cardBadge({ kind: "physical", leadTimeDays: null, inStock: true })).toEqual({
      key: "catalog.inStock",
    });
  });
  it("физический без срока и без остатка — просто «Товар», рядом значок «Нет в наличии»", () => {
    expect(cardBadge({ kind: "physical", leadTimeDays: null, inStock: false })).toEqual({
      key: "catalog.product",
    });
  });
});
