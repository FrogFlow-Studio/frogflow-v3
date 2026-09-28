import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { loadConsultantUsage, recordConsultantRun, summarizeConsultantRuns } from "./runs";

/** Журнал ответов консультанта (перенос src/lib/consultant/runs.ts v1). */
function ctxOf(): TenantContext {
  const db = fakeDb({ unique: { consultant_message_runs: [["bot_id", "message_id"]] } });
  db.tables.consultant_message_runs = [];
  return {
    tenant: { id: "b1", settings: {} },
    db,
    timezone: "Asia/Almaty",
  } as unknown as TenantContext;
}

describe("журнал ответов консультанта", () => {
  it("строка на сообщение: цена, кеш, инструменты; повтор доставки строк не плодит", async () => {
    const ctx = ctxOf();
    const run = {
      messageId: "mid-1",
      conversationId: "conv",
      userKey: "ig_1",
      source: "webhook" as const,
      incomingText: "Сколько в рублях?",
      replyText: "Uchino 50х100 - 2 023 ₽.",
      model: "claude-haiku-4-5",
      usage: {
        inputTokens: 100,
        outputTokens: 50,
        cacheWriteTokens: 0,
        cacheReadTokens: 900,
        usd: 0.0012,
      },
      rate: { value: 4.2, updatedAt: "2026-09-25T06:00:00Z", source: "manual" },
      tools: ["search_products «полотенца»"],
    };
    await recordConsultantRun(ctx, run);
    await recordConsultantRun(ctx, run);
    const rows = (ctx.db as unknown as { tables: Record<string, Record<string, unknown>[]> }).tables
      .consultant_message_runs!;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      bot_id: "b1",
      status: "replied",
      rate_value: 4.2,
      token_usage: { input: 100, cache_read: 900, usd: 0.0012 },
      tool_trace: [{ tools: ["search_products «полотенца»"] }],
    });
  });

  it("ответ не ушёл — terminal_failed без sent_at", async () => {
    const ctx = ctxOf();
    await recordConsultantRun(ctx, {
      messageId: "mid-2",
      conversationId: "conv",
      userKey: "ig_1",
      source: "webhook",
      status: "terminal_failed",
      errorCode: "send_failed",
    });
    const row = (ctx.db as unknown as { tables: Record<string, Record<string, unknown>[]> }).tables
      .consultant_message_runs![0]!;
    expect(row).toMatchObject({
      status: "terminal_failed",
      sent_at: null,
      error_code: "send_failed",
    });
  });

  it("без id сообщения — не пишет", async () => {
    const ctx = ctxOf();
    await recordConsultantRun(ctx, {
      messageId: "",
      conversationId: "c",
      userKey: "u",
      source: "webhook",
    });
    expect(
      (ctx.db as unknown as { tables: Record<string, unknown[]> }).tables.consultant_message_runs,
    ).toHaveLength(0);
  });

  it("сводка по дням магазина: цена ответа и доля кеша", async () => {
    const s = summarizeConsultantRuns(
      [
        {
          received_at: "2026-09-25T20:00:00Z",
          token_usage: { usd: 0.002, input: 100, cache_read: 900 },
        },
        {
          received_at: "2026-09-25T10:00:00Z",
          token_usage: { usd: 0.004, input: 500, cache_write: 500 },
        },
      ],
      "Asia/Almaty",
    );
    // 20:00 UTC — уже 26-е по Алматы.
    expect(s.days.map((d) => d.date)).toEqual(["2026-09-26", "2026-09-25"]);
    expect(s.usdPerMessage).toBeCloseTo(0.003);
    expect(s.cacheReadShare).toBeCloseTo(0.45);
    const ctx = ctxOf();
    await recordConsultantRun(ctx, {
      messageId: "m",
      conversationId: "c",
      userKey: "u",
      source: "webhook",
      usage: { inputTokens: 1, outputTokens: 1, usd: 0.01 },
    });
    (
      ctx.db as unknown as { tables: Record<string, Record<string, unknown>[]> }
    ).tables.consultant_message_runs![0]!.received_at = new Date().toISOString();
    expect((await loadConsultantUsage(ctx)).messages).toBe(1);
  });
});
