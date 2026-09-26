import { describe, expect, it } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { processBroadcastBatch, type BroadcastSender } from "./broadcasts";
import { CLAIM_STALE_MS, STALE_CLAIM_ERROR } from "./pure";

const BOT = "00000000-0000-0000-0000-000000000001";

function setup(recipients: number[]) {
  const db = fakeDb({
    rpc: {
      increment_broadcast_counts: (d: FakeDb, a) => {
        const b = d.tables.broadcasts!.find((x) => x.id === a.p_broadcast_id)!;
        b.sent_count = (b.sent_count as number) + (a.p_sent as number);
        b.failed_count = (b.failed_count as number) + (a.p_failed as number);
        b.blocked_count = (b.blocked_count as number) + (a.p_blocked as number);
      },
    },
  });
  db.tables.broadcasts = [
    {
      id: "b1",
      bot_id: BOT,
      status: "queued",
      channel: "telegram",
      message_text: "привет",
      photo_paths: [],
      product_ids: [],
      show_catalog: false,
      total_count: recipients.length,
      sent_count: 0,
      failed_count: 0,
      blocked_count: 0,
      created_at: "2026-09-26T00:00:00Z",
    },
  ];
  db.tables.broadcast_recipients = recipients.map((id, i) => ({
    id: `r${i}`,
    bot_id: BOT,
    broadcast_id: "b1",
    telegram_id: id,
    phone: null,
    status: "pending",
    sent_at: null,
    error_message: null,
  }));
  const ctx = { tenant: { id: BOT }, db } as unknown as TenantContext;
  return { db, ctx };
}

describe("processBroadcastBatch: один человек — одно сообщение", () => {
  it("два пересёкшихся запуска крона не шлют одному получателю дважды", async () => {
    const { db, ctx } = setup([101, 102, 103, 104, 105]);
    const delivered: number[] = [];
    const send: BroadcastSender = async ({ telegramId }) => {
      await new Promise((r) => setTimeout(r, 5));
      delivered.push(telegramId);
    };
    const [a, b] = await Promise.all([
      processBroadcastBatch(ctx, send),
      processBroadcastBatch(ctx, send),
    ]);
    expect(delivered.sort()).toEqual([101, 102, 103, 104, 105]);
    expect(a.sent + b.sent).toBe(5);
    const row = db.tables.broadcasts![0]!;
    expect(row.sent_count).toBe(5);
    expect(row.status).toBe("completed");
    expect(db.tables.broadcast_recipients!.every((r) => r.status === "sent")).toBe(true);
  });

  it("брошенного упавшим запуском получателя не шлёт повторно, а считает недоставленным", async () => {
    const { db, ctx } = setup([201, 202]);
    const old = new Date(Date.now() - CLAIM_STALE_MS - 60_000).toISOString();
    db.tables.broadcast_recipients![0]!.sent_at = old; // захвачен и брошен
    const delivered: number[] = [];
    const r = await processBroadcastBatch(ctx, async ({ telegramId }) => {
      delivered.push(telegramId);
    });
    expect(delivered).toEqual([202]);
    expect(r).toMatchObject({ sent: 1, failed: 1, done: true });
    expect(db.tables.broadcast_recipients![0]).toMatchObject({
      status: "failed",
      error_message: STALE_CLAIM_ERROR,
    });
  });

  it("свежий захват другим запуском не трогает и рассылку не закрывает", async () => {
    const { db, ctx } = setup([301, 302]);
    db.tables.broadcast_recipients![0]!.sent_at = new Date().toISOString();
    const delivered: number[] = [];
    const r = await processBroadcastBatch(ctx, async ({ telegramId }) => {
      delivered.push(telegramId);
    });
    expect(delivered).toEqual([302]);
    expect(r.done).toBe(false);
    expect(db.tables.broadcasts![0]!.status).toBe("sending");
  });

  it("ошибку канала пишет как failed/blocked и не оставляет метку захвата", async () => {
    const { db, ctx } = setup([401]);
    const r = await processBroadcastBatch(ctx, async () => {
      throw new Error("Forbidden: bot was blocked by the user");
    });
    expect(r.blocked).toBe(1);
    expect(db.tables.broadcast_recipients![0]).toMatchObject({ status: "blocked", sent_at: null });
  });
});
