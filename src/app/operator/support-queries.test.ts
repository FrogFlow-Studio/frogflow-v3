import { describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";

/** Входящие поддержки: 5 и 50 обращений читаются одним и тем же числом запросов. */
let db: FakeDb;
vi.mock("@/core/db/client.server", () => ({ serviceDb: () => db }));
vi.mock("@/core/tenant/resolve.server", async (orig) => ({
  ...(await orig<object>()),
  tenantDirectory: async () => [],
}));

const { supportInbox } = await import("./support.server");

async function inboxQueries(n: number): Promise<number> {
  db = fakeDb();
  db.tables.platform_threads = Array.from({ length: n }, (_, i) => ({
    id: `t${String(i).padStart(3, "0")}`,
    bot_id: `b${i}`,
    status: i % 2 ? "new" : "in_progress",
    labels: [`метка${i % 4}`],
    created_at: "2026-10-01T00:00:00Z",
    last_message_at: `2026-10-02T00:00:${String(i % 60).padStart(2, "0")}Z`,
    last_seller_message_at: "2026-10-02T00:00:00Z",
    last_operator_message_at: null,
    first_response_at: null,
    due_at: null,
    seller_unread: 0,
    operator_unread: 1,
    rev: 0,
  }));
  const inbox = await supportInbox();
  expect(inbox!.rows).toHaveLength(n);
  return db.queries;
}

describe("входящие поддержки: число запросов", () => {
  it("5 и 50 обращений — столько же запросов", async () => {
    expect(await inboxQueries(50)).toBe(await inboxQueries(5));
  });
});
