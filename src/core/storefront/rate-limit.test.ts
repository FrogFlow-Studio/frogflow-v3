import { describe, expect, it } from "vitest";
import { COURSE_BUDGET, MINI_APP_BUDGETS, rateLimiter, takeCourse } from "./rate-limit";

const B = { limit: 3, windowMs: 60_000 };

describe("лимит частоты Mini App", () => {
  it("пачка оформлений упирается в лимит у каждого покупателя отдельно", () => {
    const l = rateLimiter();
    const t = 1_000;
    expect([1, 2, 3, 4].map(() => l.take("bot:1:checkout", B, t))).toEqual([
      true,
      true,
      true,
      false,
    ]);
    // Сосед по магазину и тот же покупатель в другом магазине — свои бюджеты.
    expect(l.take("bot:2:checkout", B, t)).toBe(true);
    expect(l.take("other:1:checkout", B, t)).toBe(true);
  });

  it("оформление и «Мои заказы» не делят один бюджет", () => {
    const l = rateLimiter();
    for (let i = 0; i < 3; i++) l.take("bot:1:checkout", B, 0);
    expect(l.take("bot:1:checkout", B, 0)).toBe(false);
    expect(l.take("bot:1:orders", B, 0)).toBe(true);
  });

  it("окно скользит: старые попытки перестают считаться", () => {
    const l = rateLimiter();
    for (let i = 0; i < 3; i++) l.take("k", B, i * 1_000);
    expect(l.take("k", B, 59_999)).toBe(false);
    // Первая попытка (t=0) вышла из окна — место освободилось одно.
    expect(l.take("k", B, 60_000)).toBe(true);
    expect(l.take("k", B, 60_001)).toBe(false);
  });

  it("отказ не продлевает паузу: долбёжка не запирает покупателя навсегда", () => {
    const l = rateLimiter();
    for (let i = 0; i < 3; i++) l.take("k", B, 0);
    for (let t = 1; t < 60_000; t += 5_000) l.take("k", B, t);
    expect(l.take("k", B, 60_000)).toBe(true);
  });

  it("память ограничена: при переполнении старые ключи вытесняются", () => {
    const l = rateLimiter(2);
    l.take("a", B, 0);
    l.take("b", B, 0);
    l.take("c", B, 0);
    expect(l.size()).toBe(2);
  });

  it("у оформления бюджет строже, чем у просмотра заказов", () => {
    expect(MINI_APP_BUDGETS.checkout.limit).toBeLessThan(MINI_APP_BUDGETS.orders.limit);
  });
});

describe("лимит частоты страницы курса", () => {
  it("одна покупка не подписывает файлы без конца; другая покупка считается отдельно", () => {
    const bot = "bot-course";
    for (let i = 0; i < COURSE_BUDGET.limit; i++) expect(takeCourse(bot, "item-1")).toBe(true);
    expect(takeCourse(bot, "item-1")).toBe(false);
    expect(takeCourse(bot, "item-2")).toBe(true);
    expect(takeCourse("other-bot", "item-1")).toBe(true);
  });
});
