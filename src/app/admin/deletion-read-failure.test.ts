import { describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { Tenant } from "@/core/tenant/types";

/** Не удалось прочитать список файлов клиента: ничего не удаляется, ошибка попадает в результат. */
const state = vi.hoisted(() => ({ db: null as unknown, removes: 0, listFails: true }));

vi.mock("@/core/db/client.server", () => ({
  serviceDb: () => ({
    from: (t: string) => (state.db as { from: (t: string) => unknown }).from(t),
    storage: {
      from: () => ({
        list: async () =>
          state.listFails
            ? { data: null, error: { message: "storage down" } }
            : { data: [{ name: "a.pdf", id: "1" }], error: null },
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
vi.mock("@/app/operator/health-alerts.server", () => ({ sendOperatorAlert: async () => {} }));
vi.mock("@/channels/telegram/notify", () => ({ adminTelegramApi: () => null }));

const { finalizeDueDeletions } = await import("./deletion.server");

const DAY = 86_400_000;
const NOW = Date.parse("2026-10-10T08:00:00Z");
const tenant = {
  id: "bot",
  name: "Школа",
  archived: false,
  settings: {
    deletion: {
      requested_at: new Date(NOW - 40 * DAY).toISOString(),
      by: "seller",
      prev_status: "active",
    },
  },
} as unknown as Tenant;

describe("удаление файлов клиента: упавшее чтение не превращается в «удалить всё»", () => {
  it("список не прочитан: remove не вызывался, в результате ошибка, а не «удалено 0»", async () => {
    const db = fakeDb();
    db.tables.bots = [{ id: "bot", status: "paused", archived_at: null }];
    state.db = db;
    state.removes = 0;
    state.listFails = true;
    const r = await finalizeDueDeletions([tenant], NOW);
    expect(state.removes).toBe(0);
    expect(r.bot).toMatchObject({ ok: false });
    expect(String((r.bot as { error: string }).error)).toContain("storage down");
  });

  it("список прочитан: файлы удаляются (проверка, что тест видит настоящий путь)", async () => {
    const db = fakeDb();
    db.tables.bots = [{ id: "bot", status: "paused", archived_at: null }];
    state.db = db;
    state.removes = 0;
    state.listFails = false;
    const r = await finalizeDueDeletions([tenant], NOW);
    expect(state.removes).toBe(3);
    expect(r.bot).toMatchObject({ archived: true });
  });
});
