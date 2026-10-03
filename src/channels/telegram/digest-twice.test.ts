import { describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Tenant } from "@/core/tenant/types";

// Два крона одновременно (окно переключения v2 → v3): дайджест — один раз в день.
const state = vi.hoisted(() => ({ ctx: null as unknown, notify: 0 }));

vi.mock("@/core/tenant/resolve.server", () => ({ tenantContext: () => state.ctx }));
vi.mock("./notify", () => ({
  notifyAdminsHtml: vi.fn(async () => {
    state.notify++;
    await Promise.resolve();
    return 1;
  }),
}));
vi.mock("@/core/orders/admin", () => ({
  orderCounts: async () => ({}),
  revenue: async () => ({ orders: 0, total: 0, currency: "KZT" }),
}));
vi.mock("@/core/outbox/outbox", () => ({ countUndelivered: async () => 0 }));

const { sendDueDigests } = await import("./digest.server");

// 09:00 в Алматы.
const NOW = new Date("2026-10-10T04:00:00Z");

function setup() {
  const db = fakeDb({ unique: { app_settings: [["bot_id", "key"]] } });
  db.tables.app_settings = [
    {
      bot_id: "bot",
      key: "notify_prefs",
      value: JSON.stringify({ digest: { enabled: true, hour: 9 } }),
    },
  ];
  db.tables.zernio_logs = [];
  state.ctx = {
    tenant: { id: "bot", modules: { notify_in_bot: true }, settings: {} },
    timezone: "Asia/Almaty",
    db,
  } as unknown as TenantContext;
  state.notify = 0;
  return db;
}

const tenant = { id: "bot", telegramTokenEnc: "enc" } as unknown as Tenant;

describe("дайджест: два прогона одновременно", () => {
  it("уходит один раз, отметка дня одна", async () => {
    const db = setup();
    const [a, b] = await Promise.all([
      sendDueDigests([tenant], NOW),
      sendDueDigests([tenant], NOW),
    ]);
    expect(state.notify).toBe(1);
    expect([a.bot, b.bot].filter((x) => x === "sent")).toHaveLength(1);
    const marks = db.tables.app_settings!.filter((r) => r.key === "notify_digest_sent_on");
    expect(marks).toHaveLength(1);
    expect(marks[0]!.value).toBe("2026-10-10");
  });

  it("сорвавшаяся отправка не гасит дайджест: следующий прогон повторит", async () => {
    setup();
    const { notifyAdminsHtml } = await import("./notify");
    vi.mocked(notifyAdminsHtml).mockRejectedValueOnce(new Error("telegram down"));
    const first = await sendDueDigests([tenant], NOW);
    expect(first.bot).toContain("telegram down");
    const second = await sendDueDigests([tenant], NOW);
    expect(second.bot).toBe("sent");
  });
});
