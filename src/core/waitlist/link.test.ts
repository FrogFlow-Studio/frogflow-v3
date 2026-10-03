import { describe, expect, it } from "vitest";
import { parseWaitlistPayload, shouldJoinWaitlist, waitlistLink } from "./link";

const ID = "e2e00000-0000-4000-8000-0000000000a1";

describe("ссылка «Сообщить о поступлении» с сайта", () => {
  it("ведёт в бота магазина на нужный товар", () => {
    expect(waitlistLink("shop_bot", { id: ID, inStock: false }, true)).toBe(
      `https://t.me/shop_bot?start=w_${ID}`,
    );
    expect(waitlistLink("@shop_bot", { id: ID, inStock: false }, true)).toBe(
      `https://t.me/shop_bot?start=w_${ID}`,
    );
  });

  it("только при нулевом остатке, модуле и известном боте", () => {
    expect(waitlistLink("shop_bot", { id: ID, inStock: true }, true)).toBeNull();
    expect(waitlistLink("shop_bot", { id: ID, inStock: false }, false)).toBeNull();
    expect(waitlistLink(null, { id: ID, inStock: false }, true)).toBeNull();
  });

  it("параметр /start влезает в лимит Telegram и разбирается обратно", () => {
    const link = waitlistLink("b", { id: ID, inStock: false }, true)!;
    const payload = link.split("start=")[1]!;
    expect(payload.length).toBeLessThanOrEqual(64);
    expect(parseWaitlistPayload(payload)).toBe(ID);
    expect(parseWaitlistPayload("w_не-товар")).toBeNull();
    expect(parseWaitlistPayload(`p_${ID}`)).toBeNull();
  });

  it("бот записывает только на товар без остатка при модуле «Склад»", () => {
    expect(shouldJoinWaitlist(true, { stock_quantity: 0 })).toBe(true);
    expect(shouldJoinWaitlist(true, { stock_quantity: 2 })).toBe(false);
    expect(shouldJoinWaitlist(true, { stock_quantity: null })).toBe(false);
    expect(shouldJoinWaitlist(false, { stock_quantity: 0 })).toBe(false);
  });
});
