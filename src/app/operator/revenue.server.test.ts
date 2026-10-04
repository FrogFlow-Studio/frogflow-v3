import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";

let db: FakeDb;
const tenant = (id: string, name: string, plan: string | null, billing = {}, archived = false) => ({
  id,
  name,
  plan,
  archived,
  settings: { billing },
});
let tenants: ReturnType<typeof tenant>[] = [];

vi.mock("@/core/db/client.server", () => ({ serviceDb: () => db }));
vi.mock("@/core/tenant/resolve.server", () => ({ tenantDirectory: async () => tenants }));

const { revenueReport } = await import("./revenue.server");
const NOW = new Date("2026-09-26T12:00:00Z");

beforeEach(() => {
  db = fakeDb({ maxRows: 1000 });
  tenants = [
    tenant("a", "Альфа", "digital.pro"),
    tenant("b", "Бета", "digital.basic"),
    tenant("c", "Гамма", "digital.basic"),
  ];
  db.tables.bots = [
    { id: "a", subscription_expires_at: "2026-10-02" },
    { id: "b", subscription_expires_at: "2026-09-20" },
    { id: "c", subscription_expires_at: "2026-12-01" },
  ];
  db.tables.subscription_payments = [];
});

describe("выручка оператора: продления, отток, тарифы", () => {
  it("продления и отток из сроков подписки, тариф платежа — тариф клиента", async () => {
    db.tables.subscription_payments = [
      { id: "p1", bot_id: "a", paid_at: "2026-09-02T10:00:00Z", amount: "19900", currency: "KZT" },
      { id: "p2", bot_id: "b", paid_at: "2026-08-20T10:00:00Z", amount: "9900", currency: "KZT" },
      { id: "p3", bot_id: "b", paid_at: "2026-08-21T10:00:00Z", amount: "0", currency: "KZT" },
    ];
    const r = await revenueReport(NOW);
    expect(r.renewals.map((x) => x.botId)).toEqual(["a"]);
    expect(r.renewalsExpected).toBe(19_900);
    expect(r.churn.clients.map((x) => x.botId)).toEqual(["b"]);
    expect(r.churn.lostMrr).toBe(9_900);
    const sep = r.cashByTier.find((m) => m.month === "2026-09")!;
    expect(sep).toMatchObject({ pro: 19_900, total: 19_900, count: 1 });
    const aug = r.cashByTier.find((m) => m.month === "2026-08")!;
    expect(aug).toMatchObject({ basic: 9_900, total: 9_900, count: 1 });
  });

  it("сроки подписок читаются все, а не первые 1000 клиентов", async () => {
    tenants = Array.from({ length: 1200 }, (_, i) =>
      tenant(`t${String(i).padStart(4, "0")}`, `Клиент ${i}`, "digital.basic"),
    );
    db.tables.bots = tenants.map((t) => ({ id: t.id, subscription_expires_at: "2026-10-01" }));
    const r = await revenueReport(NOW);
    expect(r.renewals).toHaveLength(1200);
  });

  it("сбой чтения платежей — исключение, а не пустая выручка", async () => {
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
    await expect(revenueReport(NOW)).rejects.toThrow(/оплаты подписок/);
  });
});
