import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";

let db: FakeDb;
let tenants: Array<Record<string, unknown>> = [];
const alertsSeen: Array<{ probes: unknown[]; names: Map<string, string> }> = [];
vi.mock("./health-alerts.server", () => ({
  processHealthAlerts: async (probes: unknown[], names: Map<string, string>) => {
    alertsSeen.push({ probes, names });
    return { down: 0, up: 0, sent: 0, notConfigured: true };
  },
}));
vi.mock("@/core/db/client.server", () => ({ serviceDb: () => db }));
vi.mock("@/core/tenant/resolve.server", () => ({
  tenantDirectory: async () => tenants,
  tenantContext: () => ({}),
}));

const { latestHealth, getHealthHistory, recordHealthSnapshots } = await import("./health.server");

const NOW = Date.now();
const at = (minutesAgo: number) => new Date(NOW - minutesAgo * 60_000).toISOString();
let seq = 0;
const snap = (bot_id: string, minutesAgo: number, ok = true, error: string | null = null) => ({
  id: `s-${String(++seq).padStart(6, "0")}`,
  bot_id,
  at: at(minutesAgo),
  ok,
  error,
  pending_updates: 0,
});

beforeEach(() => {
  // Потолок ответа, как у Supabase.
  db = fakeDb({ maxRows: 1000 });
  seq = 0;
  alertsSeen.length = 0;
});

describe("здоровье ботов в панели оператора", () => {
  it("последний снимок находится у каждого клиента, сколько бы снимков ни было у соседей", async () => {
    // 3000 свежих снимков у busy — больше прежнего предела в 1500 и потолка в 1000.
    db.tables.bot_health_snapshots = [
      snap("quiet", 60 * 24 * 3, false, "вебхук: не установлен"),
      ...Array.from({ length: 3000 }, (_, i) => snap("busy", i % 60)),
    ];
    tenants = [{ id: "busy" }, { id: "quiet" }, { id: "never" }];
    const all = await latestHealth();
    expect([...all.keys()].sort()).toEqual(["busy", "quiet"]);
    expect(all.get("quiet")).toMatchObject({ ok: false, error: "вебхук: не установлен" });
    expect(all.get("busy")!.at).toBe(at(0));
    expect([...(await latestHealth(["quiet"])).keys()]).toEqual(["quiet"]);
  });

  it("история за 14 дней читается целиком, а не первые 1000 снимков", async () => {
    // Снимок раз в 15 минут: 1344 за 14 дней. Падение — в последние сутки.
    db.tables.bot_health_snapshots = Array.from({ length: 1344 }, (_, i) => {
      const minutesAgo = (1343 - i) * 15;
      return snap("b", minutesAgo, !(minutesAgo <= 120 && minutesAgo > 60), "timeout");
    });
    const h = await getHealthHistory("b", 14);
    expect(h.snapshotCount).toBe(1344);
    expect(h.outages).toHaveLength(1);
    expect(h.outages[0]!.startedAt).toBe(at(120));
    expect(h.outages[0]!.endedAt).toBe(at(60));
  });

  it("крон передаёт уведомлениям только клиентов v2 без архива; проверка из панели — нет", async () => {
    tenants = [
      {
        id: "v2",
        name: "Магазин",
        settings: { served_by: "v2" },
        archived: false,
        telegramTokenEnc: null,
      },
      {
        id: "old",
        name: "Старый",
        settings: { served_by: "v2" },
        archived: true,
        telegramTokenEnc: null,
      },
      { id: "v1", name: "На v1", settings: {}, archived: false, telegramTokenEnc: null },
    ];
    const r = await recordHealthSnapshots();
    expect(r.alerts).toMatchObject({ notConfigured: true });
    expect(alertsSeen).toHaveLength(1);
    expect([...alertsSeen[0]!.names.keys()]).toEqual(["v2"]);
    expect((await recordHealthSnapshots("v2")).alerts).toBeUndefined();
    expect(alertsSeen).toHaveLength(1);
  });
});
