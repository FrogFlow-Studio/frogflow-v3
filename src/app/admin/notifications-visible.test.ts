import { describe, expect, it } from "vitest";
import { notificationsInNav } from "./notifications-visible";

describe("пункт «Уведомления» в меню", () => {
  it("продающий магазин и магазин без признака — пункт есть", () => {
    expect(notificationsInNav({ role: "owner", sells: true })).toBe(true);
    expect(notificationsInNav({ role: "owner" })).toBe(true);
  });
  it("консультант без продаж — пункта нет (лента всегда пуста)", () => {
    expect(notificationsInNav({ role: "owner", sells: false })).toBe(false);
    expect(notificationsInNav({ role: "manager", sells: false })).toBe(false);
  });
});
