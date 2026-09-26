import { describe, expect, it, vi } from "vitest";
import { routeOperatorName } from "./login-route";

describe("вход с логином оператора", () => {
  it("пароль оператора — панель оператора, пароль магазина не проверяется", async () => {
    const shop = vi.fn(async () => true);
    expect(await routeOperatorName({ operator: async () => true, shop })).toBe("operator");
    expect(shop).not.toHaveBeenCalled();
  });

  it("магазин с тем же логином входит своим паролем", async () => {
    expect(await routeOperatorName({ operator: async () => false, shop: async () => true })).toBe(
      "shop",
    );
  });

  it("ни один пароль не подошёл — неудача оператора", async () => {
    expect(await routeOperatorName({ operator: async () => false, shop: async () => false })).toBe(
      "denied",
    );
  });
});
