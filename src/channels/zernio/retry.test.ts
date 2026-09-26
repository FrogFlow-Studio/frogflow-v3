import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { claimedAt, retryStuckEvents, type DispatchOutcome } from "./dispatch.server";

const NOW = new Date("2026-09-26T12:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const MIN = 60_000;

function setup(rows: Array<Record<string, unknown>>) {
  const db = fakeDb({ unique: { zernio_logs: [["event_id"]] } });
  db.tables.zernio_logs = rows.map((r) => ({
    event_type: "message.received",
    payload: { event: "message.received" },
    error_message: null,
    ...r,
  }));
  const ctx = { tenant: { id: "bot-a" }, db } as unknown as TenantContext;
  const seen: string[] = [];
  const dispatch = async (_c: TenantContext, id: string): Promise<DispatchOutcome> => {
    seen.push(id);
    return { status: "processed", note: "ок" };
  };
  const row = (id: string) => db.tables.zernio_logs!.find((r) => r.event_id === id)!;
  return { ctx, seen, dispatch, row };
}

describe("добор зависших событий Zernio", () => {
  it("событие старше суток закрывается без ответа — на вчерашнее не пишем", async () => {
    const s = setup([
      { event_id: "old", status: "received", created_at: ago(25 * 60 * MIN) },
      { event_id: "stuck", status: "received", created_at: ago(5 * MIN) },
    ]);
    const r = await retryStuckEvents(s.ctx, NOW, s.dispatch);
    expect(s.seen).toEqual(["stuck"]);
    expect(r).toMatchObject({ found: 2, processed: 1, expired: 1 });
    expect(s.row("old")).toMatchObject({ status: "failed" });
    expect(String(s.row("old").error_message)).toContain("старше суток");
    expect(s.row("stuck")).toMatchObject({ status: "processed", error_message: "добор: ок" });
  });

  it("строку, брошенную прошлым добором, закрывает как сбой и не повторяет", async () => {
    const s = setup([
      {
        event_id: "hung",
        status: "retrying",
        created_at: ago(60 * MIN),
        error_message: `добор начат ${ago(20 * MIN)}`,
      },
      {
        event_id: "running",
        status: "retrying",
        created_at: ago(60 * MIN),
        error_message: `добор начат ${ago(2 * MIN)}`,
      },
    ]);
    const r = await retryStuckEvents(s.ctx, NOW, s.dispatch);
    expect(s.seen).toEqual([]);
    expect(r.abandoned).toBe(1);
    expect(s.row("hung").status).toBe("failed");
    // Идущий прямо сейчас добор не трогаем.
    expect(s.row("running").status).toBe("retrying");
  });

  it("забранная строка помечена временем захвата", async () => {
    const s = setup([{ event_id: "e", status: "received", created_at: ago(5 * MIN) }]);
    let during: unknown;
    await retryStuckEvents(s.ctx, NOW, async (_c, id) => {
      during = s.row(id).error_message;
      return { status: "failed", note: "сбой" };
    });
    expect(claimedAt(String(during))).toBe(NOW.getTime());
    expect(s.row("e")).toMatchObject({ status: "failed", error_message: "добор: сбой" });
    expect(claimedAt("добор: сбой")).toBeNull();
  });
});
