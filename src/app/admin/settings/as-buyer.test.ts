import { describe, expect, it } from "vitest";
import { asBuyerHref } from "./as-buyer";

describe("«Моя витрина как покупатель» (П5)", () => {
  it("ведёт на публичную витрину магазина", () => {
    expect(asBuyerHref("lavka")).toBe("/s/lavka");
  });
  it("без адреса витрины (клиент прежней платформы) кнопки нет", () => {
    expect(asBuyerHref(null)).toBeNull();
    expect(asBuyerHref("")).toBeNull();
  });
});
