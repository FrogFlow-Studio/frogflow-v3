import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import { setEnvForTests } from "@/config/env";
import type { TenantContext } from "@/core/tenant/resolve.server";

vi.mock("@/lib/errors", () => ({ reportError: vi.fn(async () => {}) }));

/** Модель отвечает не сразу — пока она думает, параллельные запросы успевают начаться. */
const create = vi.fn(async () => {
  await new Promise((r) => setTimeout(r, 5));
  return {
    stop_reason: "end_turn",
    content: [{ type: "text", text: "Описание товара для витрины." }],
    usage: { input_tokens: 1000, output_tokens: 400 },
  };
});
const clientOpts: Array<{ timeout?: number }> = [];
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    constructor(opts: { timeout?: number }) {
      clientOpts.push(opts);
    }
    messages = { create };
  },
}));

const { assistText, explainSales } = await import("./assistant.server");
const { ASSIST_DAILY_LIMIT } = await import("./prompts");
const { getSetting } = await import("@/core/settings/settings");

const BOT = "11111111-1111-1111-1111-111111111111";
const ctxOf = (consultant_limits?: { daily_usd: number }) =>
  ({
    tenant: { id: BOT, settings: consultant_limits ? { consultant_limits } : {} },
    db: fakeDb({ unique: { app_settings: [["bot_id", "key"]] } }),
  }) as unknown as TenantContext;
const req = { task: "description", product: { name: "Пазлы" }, lang: "ru" } as const;

afterEach(() => {
  setEnvForTests(undefined);
  create.mockReset();
  create.mockImplementation(async () => {
    await new Promise((r) => setTimeout(r, 5));
    return {
      stop_reason: "end_turn",
      content: [{ type: "text", text: "Описание товара для витрины." }],
      usage: { input_tokens: 1000, output_tokens: 400 },
    };
  });
  clientOpts.length = 0;
});

describe("ИИ-помощник продавца: пределы при параллельных запросах", () => {
  it("из 60 одновременных черновиков модель зовётся не больше дневного предела", async () => {
    setEnvForTests({ ANTHROPIC_API_KEY: "sk-test" });
    const ctx = ctxOf();
    const res = await Promise.allSettled(
      Array.from({ length: 60 }, () => assistText(ctx, req as never)),
    );
    const ok = res.filter((r) => r.status === "fulfilled").length;
    expect(create.mock.calls.length).toBe(ok);
    expect(ok).toBeLessThanOrEqual(ASSIST_DAILY_LIMIT);
    expect(ok).toBeGreaterThan(0);
  });

  it("предел в долларах держится: параллельные запросы видят брони друг друга", async () => {
    setEnvForTests({ ANTHROPIC_API_KEY: "sk-test" });
    // $0.01 при брони $0.03: одновременно в работе не больше одного вызова,
    // а следующие проходят, только когда бронь сменилась настоящей ценой.
    const ctx = ctxOf({ daily_usd: 0.01 });
    await Promise.allSettled(Array.from({ length: 30 }, () => assistText(ctx, req as never)));
    const calls = create.mock.calls.length;
    const spent = JSON.parse((await getSetting(ctx, "consultant_daily"))!).usd;
    expect(calls).toBeGreaterThan(0);
    // Настоящая цена черновика — $0.003; потрачено не больше предела плюс одна цена.
    expect(spent).toBeCloseTo(calls * 0.003, 6);
    expect(spent).toBeLessThanOrEqual(0.01 + 0.003);
  });

  it("после ответа бронь меняется на настоящую цену", async () => {
    setEnvForTests({ ANTHROPIC_API_KEY: "sk-test" });
    const ctx = ctxOf();
    await assistText(ctx, req as never);
    const daily = JSON.parse((await getSetting(ctx, "consultant_daily"))!);
    // 1000 × $1 + 400 × $5 за миллион токенов.
    expect(daily.usd).toBeCloseTo(0.003, 6);
    expect(JSON.parse((await getSetting(ctx, "seller_assist_daily"))!).count).toBe(1);
  });

  it("отказ в деньгах не съедает черновик из дневного счёта", async () => {
    setEnvForTests({ ANTHROPIC_API_KEY: "sk-test" });
    const ctx = ctxOf({ daily_usd: 0.01 });
    const d = new Date().toISOString().slice(0, 10);
    await ctx.db.from("app_settings").insert({
      bot_id: BOT,
      key: "consultant_daily",
      value: JSON.stringify({ date: d, usd: 0.01, calls: 0, tests: 0 }),
    });
    await expect(assistText(ctx, req as never)).rejects.toMatchObject({ key: "err.assist.budget" });
    expect(create).not.toHaveBeenCalled();
    expect(JSON.parse((await getSetting(ctx, "seller_assist_daily"))!).count).toBe(0);
  });
});

describe("ИИ-помощник: ИИ-баланс клиента", () => {
  it("баланс кончился — модель не зовём, черновик и дневной расход возвращены", async () => {
    setEnvForTests({ ANTHROPIC_API_KEY: "sk-test" });
    const ctx = ctxOf();
    await ctx.db.from("app_settings").insert({
      bot_id: BOT,
      key: "ai_balance",
      value: JSON.stringify({ usd: 0.001, low: true, empty: true }),
    });
    await expect(assistText(ctx, req as never)).rejects.toMatchObject({
      key: "err.assist.balance",
    });
    expect(create).not.toHaveBeenCalled();
    expect(JSON.parse((await getSetting(ctx, "seller_assist_daily"))!).count).toBe(0);
    expect(JSON.parse((await getSetting(ctx, "consultant_daily"))!).usd).toBe(0);
  });

  it("черновик списывает с баланса свою цену", async () => {
    setEnvForTests({ ANTHROPIC_API_KEY: "sk-test" });
    const ctx = ctxOf();
    await assistText(ctx, req as never);
    expect(JSON.parse((await getSetting(ctx, "ai_balance"))!).usd).toBeCloseTo(5 - 0.003, 6);
  });
});

describe("«Почему изменились продажи»: explainSales", () => {
  const totals = { revenue: 90000, orders: 30, avgCheck: 3000, customers: 12, buyers: 25 };
  const speed = { payMedian: 12, payP90: 90, deliverMedian: 1, autoShare: 80 };
  const digest = {
    days: 30,
    currency: "KZT",
    current: totals,
    previous: { ...totals, revenue: 120000, orders: 40 },
    currentSpeed: speed,
    previousSpeed: speed,
    byChannel: [{ channel: "telegram", orders: 30, revenue: 90000 }],
    topProducts: [{ name: "Пазлы", qty: 20, revenue: 60000 }],
    buyers: { fresh: 10, returning: 15, dormant: 4 },
  };
  const bullets = "- Выручка упала на 25 %\n- Меньше заказов";

  it("сводка уходит модели, ответ — пунктами, расход списан с баланса", async () => {
    setEnvForTests({ ANTHROPIC_API_KEY: "sk-test" });
    create.mockResolvedValue({
      stop_reason: "end_turn",
      content: [{ type: "text", text: `**Итоги**\n${bullets}` }],
      usage: { input_tokens: 1000, output_tokens: 400 },
    });
    const ctx = ctxOf();
    const text = await explainSales(ctx, digest, "ru");
    expect(text).toBe(`Итоги\n${bullets}`);
    const call = (create.mock.calls as unknown as unknown[][])[0]![0] as {
      messages: Array<{ content: string }>;
      system: string;
    };
    expect(call.messages[0]!.content).toContain("выручка 90000 KZT");
    expect(call.messages[0]!.content).toContain("Пазлы — 20 шт.");
    expect(call.system).toContain("русском");
    expect(JSON.parse((await getSetting(ctx, "ai_balance"))!).usd).toBeCloseTo(5 - 0.003, 6);
  });

  it("у запроса к модели есть тайм-аут", async () => {
    setEnvForTests({ ANTHROPIC_API_KEY: "sk-test" });
    await explainSales(ctxOf(), digest, "en");
    expect(clientOpts[0]!.timeout).toBeGreaterThan(0);
    expect(clientOpts[0]!.timeout).toBeLessThan(120_000);
  });

  it("нет баланса — модель не зовём, расход и черновик возвращены", async () => {
    setEnvForTests({ ANTHROPIC_API_KEY: "sk-test" });
    const ctx = ctxOf();
    await ctx.db.from("app_settings").insert({
      bot_id: BOT,
      key: "ai_balance",
      value: JSON.stringify({ usd: 0.001, low: true, empty: true }),
    });
    await expect(explainSales(ctx, digest, "ru")).rejects.toMatchObject({
      key: "err.assist.balance",
    });
    expect(create).not.toHaveBeenCalled();
    expect(JSON.parse((await getSetting(ctx, "consultant_daily"))!).usd).toBe(0);
  });

  it("ошибка модели — резерв снят, баланс и дневной расход целы", async () => {
    setEnvForTests({ ANTHROPIC_API_KEY: "sk-test" });
    create.mockRejectedValue(new Error("timeout"));
    const ctx = ctxOf();
    await expect(explainSales(ctx, digest, "ru")).rejects.toMatchObject({
      key: "err.assist.failed",
    });
    expect(JSON.parse((await getSetting(ctx, "ai_balance"))!).usd).toBe(5);
    expect(JSON.parse((await getSetting(ctx, "consultant_daily"))!).usd).toBe(0);
  });

  it("продаж нет в обоих периодах — отказ без вызова модели", async () => {
    setEnvForTests({ ANTHROPIC_API_KEY: "sk-test" });
    const none = { ...totals, orders: 0, revenue: 0 };
    await expect(
      explainSales(ctxOf(), { ...digest, current: none, previous: none }, "ru"),
    ).rejects.toMatchObject({ key: "err.assist.salesEmpty" });
    expect(create).not.toHaveBeenCalled();
  });
});
