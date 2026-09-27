import { describe, expect, it } from "vitest";
import { activeTab, miniAppTabs, ordersView } from "./tabs";

describe("нижние вкладки Mini App", () => {
  it("у магазина материалов есть вкладка «Материалы», у остальных нет", () => {
    expect(miniAppTabs("digital")).toEqual(["catalog", "library", "orders", "cart"]);
    expect(miniAppTabs("confectionery")).toEqual(["catalog", "orders", "cart"]);
    expect(miniAppTabs("flowers")).toEqual(["catalog", "orders", "cart"]);
  });

  it("подсвечивает вкладку по странице: каталог и товар, корзина, заказы и материалы", () => {
    expect(activeTab("/s/shop", "shop", undefined)).toBe("catalog");
    expect(activeTab("/s/shop/", "shop", undefined)).toBe("catalog");
    expect(activeTab("/s/shop/p/123", "shop", undefined)).toBe("catalog");
    expect(activeTab("/s/shop/cart", "shop", undefined)).toBe("cart");
    expect(activeTab("/s/shop/orders", "shop", undefined)).toBe("orders");
    expect(activeTab("/s/shop/orders", "shop", "library")).toBe("library");
    expect(activeTab("/s/shop/legal/offer", "shop", undefined)).toBeNull();
  });

  it("страница заказов: вкладка показывает свою часть, без вкладки — обе", () => {
    expect(ordersView("library")).toBe("library");
    expect(ordersView("orders")).toBe("orders");
    expect(ordersView(undefined)).toBe("all");
    expect(ordersView("<script>")).toBe("all");
  });
});
