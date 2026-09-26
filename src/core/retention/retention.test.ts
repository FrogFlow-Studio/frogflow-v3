import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";

let db: FakeDb;
vi.mock("@/core/db/client.server", () => ({ serviceDb: () => db }));

const { RETENTION, pruneBroadcastRecipients, pruneOperatorLoginAttempts } =
  await import("./retention");

const NOW = Date.parse("2026-09-26T00:00:00Z");
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();

beforeEach(() => {
  db = fakeDb();
});

describe("сроки хранения служебных журналов, как в v1", () => {
  it("pruneOperatorAuditTables удаляет старые попытки входа оператора, свежие остаются", async () => {
    const old = RETENTION.operatorLoginsDays + 1;
    db.tables.operator_login_attempts = [
      { id: "old-1", at: daysAgo(old), username: "a", ok: false },
      { id: "old-2", at: daysAgo(old + 30), username: "a", ok: true },
      { id: "fresh", at: daysAgo(1), username: "a", ok: true },
    ];
    expect(await pruneOperatorLoginAttempts(NOW)).toEqual({ deleted: 2, done: true });
    expect(db.tables.operator_login_attempts!.map((r) => r.id)).toEqual(["fresh"]);
  });

  it("pruneBroadcastRecipients удаляет получателей кампаний старше окна", async () => {
    const old = RETENTION.broadcastRecipientsDays + 1;
    db.tables.broadcasts = [
      { id: "b-old", bot_id: "bot-1", created_at: daysAgo(old) },
      { id: "b-new", bot_id: "bot-1", created_at: daysAgo(3) },
      { id: "b-other", bot_id: "bot-2", created_at: daysAgo(old) },
    ];
    db.tables.broadcast_recipients = [
      { id: "r1", broadcast_id: "b-old" },
      { id: "r2", broadcast_id: "b-old" },
      { id: "r3", broadcast_id: "b-new" },
      { id: "r4", broadcast_id: "b-other" },
    ];
    // Только клиенты из списка (на v2): кампания чужого клиента не трогается.
    expect(await pruneBroadcastRecipients(NOW, ["bot-1"])).toEqual({ deleted: 2, done: true });
    expect(db.tables.broadcast_recipients!.map((r) => r.id)).toEqual(["r3", "r4"]);
    // Сама кампания остаётся: чистятся только получатели.
    expect(db.tables.broadcasts!.map((b) => b.id)).toEqual(["b-old", "b-new", "b-other"]);
  });
});
