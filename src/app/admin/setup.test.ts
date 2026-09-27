import { describe, expect, it } from "vitest";
import { MOVED_MAP, movedRows, nextSetupStep, showMovedWelcome, testOrderLink } from "./setup";

const none = {
  telegram: false,
  products: false,
  payment: false,
  notifications: false,
  legal: false,
  firstOrder: false,
};

describe("мастер первого запуска", () => {
  it("следующий шаг — первый несделанный по порядку; всё сделано — null", () => {
    expect(nextSetupStep(none)).toBe("telegram");
    expect(nextSetupStep({ ...none, telegram: true, products: true })).toBe("payment");
    // Шаги можно делать не по порядку: подсвечивается самый ранний несделанный.
    expect(nextSetupStep({ ...none, telegram: true, legal: true })).toBe("products");
    const all = Object.fromEntries(Object.keys(none).map((k) => [k, true])) as typeof none;
    expect(nextSetupStep(all)).toBeNull();
  });

  it("тестовый заказ ведёт в бота продавца сразу на карточку товара", () => {
    expect(testOrderLink("my_shop_bot", "0bac1f86-5231-4e57-838d-2faa44d427e7")).toEqual({
      url: "https://t.me/my_shop_bot?start=p_0bac1f86-5231-4e57-838d-2faa44d427e7",
    });
  });

  it("без бота или без включённого товара — говорит, чего не хватает", () => {
    expect(testOrderLink(null, "p1")).toEqual({ missing: "telegram" });
    expect(testOrderLink("my_shop_bot", null)).toEqual({ missing: "products" });
    expect(testOrderLink(null, null)).toEqual({ missing: "telegram" });
  });

  it("имя бота с @ или мусором не ломает ссылку", () => {
    expect(testOrderLink("@my_shop_bot", "p1")).toEqual({
      url: "https://t.me/my_shop_bot?start=p_p1",
    });
    expect(testOrderLink("bad name/../x", "p1")).toEqual({ missing: "telegram" });
  });
});

describe("карточка продавцу, переехавшему с v1", () => {
  const base = {
    servedBy: "v2" as const,
    since: "2026-10-01T09:00:00.000Z",
    hidden: false,
    ordersBeforeMove: 3,
  };

  it("только v2, с датой переезда, с заказами до неё и пока не закрыта", () => {
    expect(showMovedWelcome(base)).toBe(true);
    expect(showMovedWelcome({ ...base, servedBy: "v1" })).toBe(false);
    expect(showMovedWelcome({ ...base, servedBy: undefined })).toBe(false);
    // Новый магазин, открытый сразу на v2: даты переезда нет.
    expect(showMovedWelcome({ ...base, since: undefined })).toBe(false);
    expect(showMovedWelcome({ ...base, ordersBeforeMove: 0 })).toBe(false);
    expect(showMovedWelcome({ ...base, hidden: true })).toBe(false);
  });

  it("«что где теперь» — только разделы включённых модулей", () => {
    const base = movedRows({}).map((r) => r.from);
    expect(base).toEqual(["orders", "catalog", "payment", "settings"]);
    const all = movedRows({
      coupons: true,
      broadcasts: true,
      manager_chat: true,
      blocked: true,
      instagram: true,
      whatsapp: true,
      vip: true,
    });
    expect(all).toHaveLength(MOVED_MAP.length);
    expect(movedRows({ gift_certificates: true }).map((r) => r.from)).toContain("promo");
  });
});
