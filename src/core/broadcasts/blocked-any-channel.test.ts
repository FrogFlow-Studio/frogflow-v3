import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { syntheticTelegramId, userKey } from "@/core/customers/customers";
import { processBroadcastBatch } from "./broadcasts";

const BOT = "00000000-0000-0000-0000-000000000001";

function seed(channel: "telegram" | "whatsapp", ids: number[], blocked: number[]) {
  const db = fakeDb({ rpc: { increment_broadcast_counts: () => {} } });
  db.tables.broadcasts = [
    {
      id: "b1",
      bot_id: BOT,
      status: "sending",
      channel,
      message_text: "привет",
      photo_paths: [],
      product_ids: [],
      show_catalog: false,
      total_count: ids.length,
      sent_count: 0,
      failed_count: 0,
      blocked_count: 0,
      created_at: "2026-11-20T00:00:00Z",
    },
  ];
  db.tables.broadcast_recipients = ids.map((id, i) => ({
    id: `r${i}`,
    bot_id: BOT,
    broadcast_id: "b1",
    telegram_id: id,
    phone: null,
    status: "pending",
    sent_at: null,
    error_message: null,
  }));
  db.tables.bot_users = [];
  db.tables.blocked_users = blocked.map((id) => ({
    bot_id: BOT,
    telegram_id: id,
    username: null,
    first_name: null,
    reason: null,
    blocked_at: "2026-11-21T00:00:00Z",
  }));
  return db;
}

describe("рассылка: заблокированный продавцом не получает её ни в каком канале", () => {
  it("WhatsApp: покупатель, заблокированный после сбора списка, не получает, строка — blocked", async () => {
    const lilia = syntheticTelegramId(userKey("whatsapp", "77010000001"));
    const other = syntheticTelegramId(userKey("whatsapp", "77010000002"));
    const db = seed("whatsapp", [lilia, other], [lilia]);
    const sent: number[] = [];
    await processBroadcastBatch(
      { tenant: { id: BOT }, db } as unknown as TenantContext,
      async ({ telegramId }) => {
        sent.push(telegramId);
      },
      "whatsapp",
    );
    expect(sent).toEqual([other]);
    const rows = db.tables.broadcast_recipients!;
    expect(rows.find((r) => r.telegram_id === lilia)!.status).toBe("blocked");
    expect(rows.find((r) => r.telegram_id === other)!.status).toBe("sent");
  });

  it("Telegram — как и раньше", async () => {
    const db = seed("telegram", [101, 102], [101]);
    const sent: number[] = [];
    await processBroadcastBatch(
      { tenant: { id: BOT }, db } as unknown as TenantContext,
      async ({ telegramId }) => {
        sent.push(telegramId);
      },
    );
    expect(sent).toEqual([102]);
  });
});
