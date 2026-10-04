import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";

/** Аккаунт, молчавший дольше тысячи событий, всё равно находится в журнале. */
let db: FakeDb;
const BOT = "00000000-0000-0000-0000-0000000000b2";

vi.mock("@/core/db/client.server", () => ({ serviceDb: () => db }));

const { zernioLastEvents } = await import("./operator.server");

const at = (min: number) => new Date(Date.UTC(2026, 9, 4, 12, 0) - min * 60_000).toISOString();

beforeEach(() => {
  db = fakeDb({ maxRows: 1000 });
});

describe("zernioLastEvents: журнал длиннее страницы", () => {
  it("находит аккаунт, чьё последнее событие глубже 1000 строк", async () => {
    const rows = Array.from({ length: 1500 }, (_, i) => ({
      bot_id: BOT,
      event_id: `w${i}`,
      event_type: "message.received",
      status: "processed",
      created_at: at(i),
      payload: { account: { accountId: i < 1400 ? "busy" : "quiet" } },
    }));
    db.tables.zernio_logs = rows;
    const out = await zernioLastEvents(BOT, ["busy", "quiet"]);
    expect(out.get("busy")).toBe(at(0));
    expect(out.get("quiet")).toBe(at(1400));
  });

  it("без wantIds хватает первой страницы: «*» найден сразу", async () => {
    db.tables.zernio_logs = Array.from({ length: 1500 }, (_, i) => ({
      bot_id: BOT,
      event_id: `w${i}`,
      event_type: "message.received",
      status: "processed",
      created_at: at(i),
      payload: { account: { accountId: "a" } },
    }));
    db.queries = 0;
    const out = await zernioLastEvents(BOT);
    expect(out.get("*")).toBe(at(0));
    expect(db.queries).toBe(1);
  });
});
