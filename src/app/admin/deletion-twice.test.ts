import { describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { Tenant } from "@/core/tenant/types";

/** Два крона ретеншна одновременно (окно переключения v2 → v3): одно удаление магазина и один алерт. */
const state = vi.hoisted(() => ({ db: null as unknown, alerts: 0, removes: 0, webhooks: 0 }));

vi.mock("@/core/db/client.server", () => ({
  serviceDb: () => ({
    from: (t: string) => (state.db as { from: (t: string) => unknown }).from(t),
    storage: {
      from: () => ({
        list: async () => {
          await new Promise((r) => setTimeout(r, 5));
          return { data: [{ name: "a.pdf", id: "1" }], error: null };
        },
        remove: async () => {
          state.removes++;
          return { error: null };
        },
      }),
    },
  }),
}));
vi.mock("@/core/tenant/resolve.server", () => ({
  invalidateTenantDirectory: () => {},
  patchTenantSettings: async () => {},
  tenantContext: () => ({}),
}));
vi.mock("@/app/operator/health-alerts.server", () => ({
  sendOperatorAlert: async () => {
    state.alerts++;
  },
}));
vi.mock("@/channels/telegram/notify", () => ({
  adminTelegramApi: () => ({
    call: async () => {
      state.webhooks++;
      return { ok: true };
    },
  }),
}));

const { finalizeDueDeletions } = await import("./deletion.server");

const DAY = 86_400_000;
const NOW = Date.parse("2026-10-10T08:00:00Z");
const tenant = {
  id: "bot",
  name: "Школа",
  archived: false,
  telegramTokenEnc: "enc",
  settings: {
    deletion: {
      requested_at: new Date(NOW - 40 * DAY).toISOString(),
      by: "seller",
      prev_status: "active",
    },
  },
} as unknown as Tenant;

describe("удаление магазина по холду: два крона одновременно", () => {
  it("магазин архивируется и файлы удаляются один раз, оператору — одно сообщение", async () => {
    const db = fakeDb();
    db.tables.bots = [{ id: "bot", status: "paused", archived_at: null }];
    state.db = db;
    state.alerts = state.removes = state.webhooks = 0;
    const [a, b] = await Promise.all([
      finalizeDueDeletions([tenant], NOW),
      finalizeDueDeletions([tenant], NOW),
    ]);
    expect(state.alerts).toBe(1);
    expect(state.webhooks).toBe(1);
    // По одному вызову remove на каждый из трёх бакетов, а не по два.
    expect(state.removes).toBe(3);
    expect([a.bot, b.bot].filter((x) => (x as { archived?: boolean })?.archived)).toHaveLength(1);
    expect(db.tables.bots![0]).toMatchObject({ status: "suspended" });
    expect(db.tables.bots![0]!.archived_at).toBe(new Date(NOW).toISOString());
  });
});
