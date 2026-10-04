import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";

/** «Последнее событие Zernio» у оператора — только вебхук, а не отметки кронов и учёта. */
let db: FakeDb;
const BOT = "00000000-0000-0000-0000-0000000000b2";

vi.mock("@/core/db/client.server", () => ({ serviceDb: () => db }));

const { zernioLastEvents } = await import("./operator.server");

const at = (min: number) => new Date(Date.UTC(2026, 9, 4, 12, 0) - min * 60_000).toISOString();

beforeEach(() => {
  db = fakeDb();
  db.tables.zernio_logs = [];
});

describe("zernioLastEvents", () => {
  it("отметки автосообщений, учёта и обращений не меняют «последнее событие»", async () => {
    db.tables.zernio_logs = [
      // Вебхук сломан два дня: последнее его событие — двое суток назад.
      {
        bot_id: BOT,
        event_id: "w1",
        event_type: "message.received",
        status: "processed",
        created_at: at(2 * 24 * 60),
        payload: { account: { accountId: "acc-1", profileId: "prof-1" } },
      },
      // А кроны каждый час пишут отметки.
      { bot_id: BOT, event_id: "a1", event_type: "automsg", status: "sent", created_at: at(10) },
      { bot_id: BOT, event_id: "a2", event_type: "automsg", status: "failed", created_at: at(5) },
      {
        bot_id: BOT,
        event_id: `inbox:${BOT}:1`,
        event_type: "inbox",
        status: "open",
        created_at: at(3),
      },
      {
        bot_id: BOT,
        event_id: "ticket:1",
        event_type: "ticket",
        status: "open",
        created_at: at(2),
      },
    ];
    const out = await zernioLastEvents(BOT);
    expect(out.get("*")).toBe(at(2 * 24 * 60));
    expect(out.get("acc-1")).toBe(at(2 * 24 * 60));
    expect(out.get("@profile")).toBe("prof-1");
  });

  it("нет событий вебхука — карта пуста, а не «10 минут назад»", async () => {
    db.tables.zernio_logs = [
      { bot_id: BOT, event_id: "a1", event_type: "automsg", status: "sent", created_at: at(10) },
    ];
    expect((await zernioLastEvents(BOT)).size).toBe(0);
  });
});
