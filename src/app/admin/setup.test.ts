import { describe, expect, it } from "vitest";
import {
  MOVED_MAP,
  movedRows,
  nextSetupStep,
  parseSkippedSteps,
  relevantSetupSteps,
  setupProgress,
  showMovedWelcome,
  SETUP_STEPS,
  testOrderLink,
  toggleSkippedStep,
} from "./setup";

const none = {
  telegram: false,
  products: false,
  payment: false,
  delivery: false,
  notifications: false,
  legal: false,
  botTexts: false,
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

  it("консультант без продаж: без заказов, каталога и оплаты", () => {
    expect(movedRows({ instagram: true }, false).map((r) => r.from)).toEqual([
      "instagram",
      "settings",
    ]);
    expect(movedRows({}, true).map((r) => r.from)).toContain("orders");
  });
});

describe("запуск магазина: процент и список шагов", () => {
  const all = relevantSetupSteps({ modules: { shop: true }, vertical: "flowers" });

  it("процент считается по фактически сделанным шагам", () => {
    expect(setupProgress(none, all, []).percent).toBe(0);
    const half = { ...none, telegram: true, products: true, payment: true, delivery: true };
    expect(setupProgress(half, all, [])).toMatchObject({ doneCount: 4, total: 8, percent: 50 });
    const full = Object.fromEntries(SETUP_STEPS.map((s) => [s, true])) as typeof none;
    expect(setupProgress(full, all, []).percent).toBe(100);
  });

  it("выключенный модуль и школа: строки «Доставка» нет, в проценте её нет", () => {
    expect(relevantSetupSteps({ modules: {}, vertical: "flowers" })).not.toContain("delivery");
    expect(relevantSetupSteps({ modules: { shop: true }, vertical: "courses" })).not.toContain(
      "delivery",
    );
    expect(all).toContain("delivery");
    const school = relevantSetupSteps({ modules: { shop: true }, vertical: "courses" });
    expect(setupProgress(none, school, []).total).toBe(7);
  });

  it("консультант без продаж (BOVI): без товаров, оплаты, доставки и первого заказа", () => {
    const bovi = relevantSetupSteps({
      modules: { shop: true, dm_shop: true },
      vertical: "consultant",
      sells: false,
    });
    expect(bovi).toEqual(["telegram", "notifications", "legal", "botTexts"]);
    // Консультант с товарами — шаги магазина на месте.
    expect(
      relevantSetupSteps({ modules: { shop: true }, vertical: "consultant", sells: true }),
    ).toEqual(relevantSetupSteps({ modules: { shop: true }, vertical: "consultant" }));
    expect(relevantSetupSteps({ modules: { shop: true }, vertical: "consultant" })).toContain(
      "products",
    );
  });

  it("скрытый шаг не входит в процент, а сделанный скрытым не считается", () => {
    const p = setupProgress({ ...none, telegram: true }, all, ["legal", "telegram"]);
    expect(p.total).toBe(7);
    expect(p.rows.find((r) => r.step === "legal")?.skipped).toBe(true);
    expect(p.rows.find((r) => r.step === "telegram")?.skipped).toBe(false);
    expect(p.percent).toBe(Math.round((1 / 7) * 100));
    // Всё скрыто — готово.
    expect(setupProgress(none, all, [...SETUP_STEPS]).percent).toBe(100);
  });

  it("следующий шаг пропускает скрытые", () => {
    expect(nextSetupStep(none, all, ["telegram"])).toBe("products");
  });

  it("список скрытых: мусор отбрасывается, порядок стабильный, повтор не плодит дубли", () => {
    expect(parseSkippedSteps("legal,xxx, telegram")).toEqual(["telegram", "legal"]);
    expect(parseSkippedSteps(null)).toEqual([]);
    expect(toggleSkippedStep("legal", "telegram", true)).toBe("telegram,legal");
    expect(toggleSkippedStep("telegram,legal", "telegram", true)).toBe("telegram,legal");
    expect(toggleSkippedStep("telegram,legal", "legal", false)).toBe("telegram");
  });
});
