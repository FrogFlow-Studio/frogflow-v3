import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";

let db: FakeDb;
let statsRpc: "ok" | "fail" = "ok";
const tenant = {
  id: "bot-1",
  name: "Магазин",
  status: "active",
  vertical: "digital",
  modules: {},
  settings: { served_by: "v2" },
  plan: null,
  pausedMessage: null,
  appUrl: null,
  ownerTelegramId: null,
  telegramTokenEnc: null,
};

vi.mock("@/core/db/client.server", () => ({
  serviceDb: () => ({
    from: (t: string) => db.from(t),
    rpc: async () =>
      statsRpc === "fail"
        ? { data: null, error: { message: "boom" } }
        : {
            data: [
              {
                bot_id: "bot-1",
                orders_total: 7,
                orders_30d: 3,
                last_order_at: "2026-10-01T10:00:00Z",
                products_total: 2,
                customers_total: 5,
                storage_bytes: 0,
              },
            ],
            error: null,
          },
  }),
}));
vi.mock("@/core/tenant/resolve.server", () => ({
  tenantDirectory: async () => [tenant],
  requireTenant: async () => tenant,
  tenantContext: () => ({}),
}));
vi.mock("./health.server", () => ({ latestHealth: async () => new Map() }));
vi.mock("./pulse.server", () => ({ loadPulse: async () => new Map() }));

const { listPayments, deletePayment } = await import("./billing.server");
const { listClients, getClient } = await import("./operator.server");

beforeEach(() => {
  db = fakeDb({ maxRows: 1000 });
  statsRpc = "ok";
  db.tables.bots = [
    {
      id: "bot-1",
      owner_name: null,
      owner_contact: null,
      notes: null,
      tags: [],
      subscription_expires_at: null,
      created_at: "2026-01-01T00:00:00Z",
    },
  ];
});

describe("платежи клиента в панели оператора", () => {
  it("читаются все, а не первые 100, и порядок стабилен при одинаковой дате", async () => {
    db.tables.subscription_payments = Array.from({ length: 2300 }, (_, i) => ({
      id: `p-${String(i).padStart(5, "0")}`,
      bot_id: "bot-1",
      period_start: "2026-01-01",
      period_end: "2026-02-01",
      amount: "1000",
      currency: "KZT",
      paid_at: "2026-02-01T00:00:00Z",
      note: null,
    }));
    db.tables.subscription_payments!.push({
      id: "other",
      bot_id: "bot-2",
      period_start: "2026-01-01",
      period_end: "2026-02-01",
      amount: "1",
      currency: "KZT",
      paid_at: "2026-02-01T00:00:00Z",
      note: null,
    });
    const rows = await listPayments("bot-1");
    expect(rows).toHaveLength(2300);
    expect(new Set(rows.map((r) => r.id)).size).toBe(2300);
    expect(rows[0]!.amount).toBe(1000);
  });

  it("сбой чтения — исключение, а не пустой список платежей", async () => {
    const orig = db.from.bind(db);
    db.from = (t: string) => {
      if (t !== "subscription_payments") return orig(t);
      const q: Record<string, unknown> = new Proxy(
        {},
        {
          get: (_t, k) =>
            k === "then"
              ? (ok: (v: unknown) => unknown) => ok({ data: null, error: { message: "down" } })
              : () => q,
        },
      );
      return q as never;
    };
    await expect(listPayments("bot-1")).rejects.toThrow(/платежи не прочитаны/);
  });

  it("сбой удаления платежа — serverFailure, а не обычная ошибка с текстом базы", async () => {
    const orig = db.from.bind(db);
    db.from = (t: string) => {
      if (t !== "subscription_payments") return orig(t);
      const q: Record<string, unknown> = new Proxy(
        {},
        {
          get: (_t, k) =>
            k === "then"
              ? (ok: (v: unknown) => unknown) => ok({ data: null, error: { message: "down" } })
              : () => q,
        },
      );
      return q as never;
    };
    await expect(deletePayment("bot-1", "p1", "operator")).rejects.toThrow(/платёж не удалён/);
  });
});

describe("статистика клиентов в панели оператора", () => {
  it("читается — цифры на месте, отметки сбоя нет", async () => {
    const [c] = await listClients();
    expect(c!.statsUnread).toBe(false);
    expect(c!.stats?.orders_30d).toBe(3);
    expect((await getClient("bot-1")).stats?.orders_total).toBe(7);
  });

  it("сбой чтения — «не прочитано», а не нули заказов", async () => {
    statsRpc = "fail";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const [c] = await listClients();
    expect(c!.statsUnread).toBe(true);
    expect(c!.stats).toBeNull();
    const one = await getClient("bot-1");
    expect(one.statsUnread).toBe(true);
    expect(one.stats).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
