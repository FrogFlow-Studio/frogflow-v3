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
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create };
  },
}));

const { assistText } = await import("./assistant.server");
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
  create.mockClear();
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
