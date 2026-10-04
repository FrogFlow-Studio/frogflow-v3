import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import { withBrokenReads } from "../../../tests/broken-db";
import type { Tenant } from "@/core/tenant/types";

/** Здоровье платформы: упавшее чтение — сбой страницы, а не зелёный светофор. */
let db: FakeDb;
let tenants: Tenant[];
vi.mock("@/core/db/client.server", () => ({ serviceDb: () => db }));
vi.mock("@/core/tenant/resolve.server", () => ({
  tenantDirectory: async () => tenants,
  tenantContext: () => ({}),
}));
vi.mock("@/config/env", () => ({ env: () => ({}) }));

const { platformHealth } = await import("./platform-health.server");
const { ServerFailure } = await import("@/lib/server-failure");

const NOW = new Date("2026-10-04T10:00:00Z");
const bot = (i: number) =>
  ({
    id: `bot-${String(i).padStart(4, "0")}`,
    archived: false,
    status: "active",
    telegramTokenEnc: "enc",
    settings: { served_by: "v2" },
  }) as unknown as Tenant;

beforeEach(() => {
  db = fakeDb();
  tenants = [];
  db.tables.operator_settings = [];
  db.tables.zernio_logs = [];
  db.tables.bot_health_snapshots = [];
});

describe("платформа: здоровье", () => {
  it("1 000+ недоставленных считаются все, а не первая страница", async () => {
    db.tables.zernio_logs = Array.from({ length: 1200 }, (_, i) => ({
      id: `l${i}`,
      event_type: "outbox.telegram",
      status: "dead",
      created_at: "2026-10-04T09:00:00Z",
    }));
    const h = await platformHealth(NOW);
    expect(h.queues.find((q) => q.id === "undelivered")?.detail).toContain("1200");
  });

  it("не удалось прочитать журнал — сбой, а не зелёный «0»", async () => {
    db = withBrokenReads(db, ["zernio_logs"]);
    await expect(platformHealth(NOW)).rejects.toBeInstanceOf(ServerFailure);
  });

  it("не удалось прочитать статусы кронов — сбой, а не «все запускались»", async () => {
    db = withBrokenReads(db, ["operator_settings"]);
    await expect(platformHealth(NOW)).rejects.toBeInstanceOf(ServerFailure);
  });

  it("не удалось прочитать снимки ботов — сбой, а не «жалоб нет»", async () => {
    tenants = [bot(1), bot(2)];
    db = withBrokenReads(db, ["bot_health_snapshots"]);
    await expect(platformHealth(NOW)).rejects.toBeInstanceOf(ServerFailure);
  });

  it("больше сотни ботов: у каждого свой последний снимок, никто не потерян", async () => {
    tenants = Array.from({ length: 250 }, (_, i) => bot(i));
    db.tables.bot_health_snapshots = tenants.flatMap((t, i) => [
      { id: `${t.id}-old`, bot_id: t.id, ok: true, at: "2026-10-03T09:00:00Z" },
      { id: `${t.id}-new`, bot_id: t.id, ok: i % 5 !== 0, at: "2026-10-04T09:00:00Z" },
    ]);
    const h = await platformHealth(NOW);
    expect(h.queues.find((q) => q.id === "telegram")?.detail).toBe("50 из 250");
  });
});
