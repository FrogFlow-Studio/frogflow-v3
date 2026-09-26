import { describe, expect, it } from "vitest";
import { sellerIds } from "./recipients";

describe("кто продавец магазина: получает заказ и жмёт его кнопки", () => {
  it("владелец из карточки клиента — продавец, даже если его нет в admin_chat_id", () => {
    expect(sellerIds("111, 222", 333)).toEqual(["111", "222", "333"]);
    expect(sellerIds("", 333)).toEqual(["333"]);
    expect(sellerIds(null, 333)).toEqual(["333"]);
  });

  it("без дублей и без владельца, если его нет", () => {
    expect(sellerIds("333;111", 333)).toEqual(["333", "111"]);
    expect(sellerIds("111", null)).toEqual(["111"]);
    expect(sellerIds(null, null)).toEqual([]);
  });

  it("чужой id в список не попадает", () => {
    expect(sellerIds("111", 333)).not.toContain("444");
  });
});
