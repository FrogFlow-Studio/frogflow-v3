import { describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../../tests/fake-db";

const db = fakeDb();
vi.mock("@/core/db/client.server", () => ({ serviceDb: () => db }));
vi.mock("@/core/tenant/resolve.server", async (orig) => ({
  ...(await orig<typeof import("@/core/tenant/resolve.server")>()),
  tenantDirectory: async () => [
    {
      id: "bot-1",
      name: "Клиент",
      vertical: "digital",
      archived: false,
      modules: {},
      settings: {},
    },
  ],
}));
const { listModuleRequests } = await import("./operator.server");

describe("очередь «Заказать подключение»", () => {
  it("250 заявок: оператор видит все, а не 200", async () => {
    db.tables.module_requests = Array.from({ length: 250 }, (_, i) => ({
      id: `r-${String(i).padStart(4, "0")}`,
      bot_id: "bot-1",
      module_key: "loyalty",
      status: "pending",
      requested_at: new Date(2026, 9, 1, 0, 0, i).toISOString(),
    }));
    const rows = await listModuleRequests();
    expect(rows).toHaveLength(250);
  });
});
