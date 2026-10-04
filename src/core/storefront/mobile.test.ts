import { describe, expect, it } from "vitest";
import { showMobileCartBar } from "./mobile";

describe("липкая корзина на телефоне", () => {
  it("видна в каталоге и на товаре, когда в корзине есть товар", () => {
    expect(showMobileCartBar("/s/demo", "demo", 2)).toBe(true);
    expect(showMobileCartBar("/s/demo/p/1", "demo", 1)).toBe(true);
  });
  it("не видна с пустой корзиной, в корзине и при оформлении", () => {
    expect(showMobileCartBar("/s/demo", "demo", 0)).toBe(false);
    expect(showMobileCartBar("/s/demo/cart", "demo", 3)).toBe(false);
    expect(showMobileCartBar("/s/demo/cart/", "demo", 3)).toBe(false);
    expect(showMobileCartBar("/s/demo/checkout", "demo", 3)).toBe(false);
  });
});
