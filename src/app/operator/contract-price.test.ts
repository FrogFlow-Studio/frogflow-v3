import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import { settingsFromJson } from "@/core/tenant/directory";

/**
 * Цена плана по договору (Дидактика: Basic за 4 950 ₸ вместо 9 900) настоящим
 * кодом условий и выставления счёта: тот же createPlanInvoice зовёт и обход
 * подписок перед продлением, и кнопка «Оплатить» владельца.
 */
let db: FakeDb;
const BOT = "00000000-0000-0000-0000-0000000000d2";

vi.mock("@/core/db/client.server", () => ({ serviceDb: () => db, tenantDb: () => db }));
vi.mock("@/lib/errors", () => ({ reportError: async () => {} }));
const events: unknown[] = [];
vi.mock("./operator.server", () => ({
  logEvent: async (...a: unknown[]) => void events.push(a),
  notifyOwner: async () => ({ delivered: ["owner"], failed: [] }),
}));
vi.mock("@/core/tenant/resolve.server", async (orig) => {
  const real = await orig<typeof import("@/core/tenant/resolve.server")>();
  const tenantOf = () => {
    const b = db.tables.bots!.find((x) => x.id === BOT)!;
    return {
      id: BOT,
      name: "DID 02",
      plan: b.plan,
      vertical: "digital",
      modules: {},
      settings: settingsFromJson(b.settings),
    };
  };
  return {
    ...real,
    invalidateTenantDirectory: () => {},
    tenantDirectory: async () => [tenantOf()],
    tenantContext: (tenant: unknown) => ({
      tenant,
      db,
      appUrl: "https://t.test",
      timezone: "Asia/Almaty",
      secrets: {},
    }),
  };
});

const plans = await import("./plans.server");
const billing = await import("./billing.server");
const { setCommissionEnabled } = await import("@/core/commission/commission.server");

const settingsOf = () => db.tables.bots!.find((b) => b.id === BOT)!.settings as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const create = (period: "month" | "year" = "month") =>
  plans.createPlanInvoice(BOT, { period, addonPrices: {} }, "operator");

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-10T10:00:00Z"));
  events.length = 0;
  db = fakeDb();
  const from = db.from.bind(db);
  db.from = ((table: string) => {
    const q = from(table) as unknown as Record<string, (...a: unknown[]) => unknown>;
    if (table === "subscription_invoices") {
      const insert = q.insert!.bind(q);
      q.insert = (r) =>
        insert({ status: "sent", created_at: new Date().toISOString(), ...(r as object) });
    }
    return q as never;
  }) as typeof db.from;
  db.tables.operator_settings = [];
  db.tables.subscription_invoices = [];
  db.tables.subscription_payments = [];
  db.tables.orders = [];
  db.tables.zernio_logs = [];
  db.tables.bots = [
    {
      id: BOT,
      plan: "digital.basic",
      settings: {
        served_by: "v2",
        grace_days: 3,
        billing: { plan: "digital.basic", grandfathered: ["vip", "web_storefront"] },
        rev: 1,
      },
    },
  ];
  await billing.setPayoutRequisites("Kaspi Gold 4400 0000 0000 0000, Иван И.");
  await setCommissionEnabled(false);
});
afterEach(() => vi.useRealTimers());

describe("цена плана по договору", () => {
  it("без условий действующему клиенту выставилось бы 9 900 + подключение 15 000", async () => {
    const r = await create();
    expect(r.invoice.amount).toBe(24_900);
  });

  it("4 950 ₸ и подключение не берётся: счёт на 4 950, строка помечена", async () => {
    await plans.setContractTerms(BOT, { monthly_price: 4_950, waive_connection: true }, "op");
    const s = settingsOf();
    expect(s.billing.monthly_price).toBe(4_950);
    expect(typeof s.billing.connection_paid_at).toBe("string");
    // Чужие поля настроек и сохранённые модули на месте, версия выросла.
    expect(s.grace_days).toBe(3);
    expect(s.billing.grandfathered).toEqual(["vip", "web_storefront"]);
    expect(s.rev).toBe(2);
    const r = await create();
    expect(r.invoice.amount).toBe(4_950);
    expect(r.invoice.note).toBe("План Basic на месяц, цена по договору: 4950 ₸");
    expect(events.find((e) => (e as unknown[])[1] === "meta")).toEqual([
      BOT,
      "meta",
      { monthly_price: 4_950, connection_waived: true },
      "op",
    ]);
  });

  it("год — 10 месяцев по цене договора", async () => {
    await plans.setContractTerms(BOT, { monthly_price: 4_950, waive_connection: true }, "op");
    expect((await create("year")).invoice.amount).toBe(49_500);
  });

  it("сброс цены возвращает тариф, оплаченное подключение не сбрасывается", async () => {
    await plans.setContractTerms(BOT, { monthly_price: 4_950, waive_connection: true }, "op");
    const paidAt = settingsOf().billing.connection_paid_at;
    await plans.setContractTerms(BOT, { monthly_price: null, waive_connection: false }, "op");
    expect(settingsOf().billing.monthly_price).toBeNull();
    expect(settingsFromJson(settingsOf()).billing?.monthly_price).toBeUndefined();
    expect(settingsOf().billing.connection_paid_at).toBe(paidAt);
    expect((await create()).invoice.amount).toBe(9_900);
  });

  it("условия можно задать до переезда: модули не трогаются", async () => {
    db.tables.bots![0]!.settings = { billing: {}, rev: 1 };
    await plans.setContractTerms(BOT, { monthly_price: 4_950, waive_connection: true }, "op");
    expect(settingsOf().billing.monthly_price).toBe(4_950);
    expect(settingsOf().served_by).toBeUndefined();
  });
});

describe("цена по договору в настройках клиента", () => {
  it("читается только положительное число", () => {
    const p = (v: unknown) => settingsFromJson({ billing: { monthly_price: v } }).billing;
    expect(p(4_950)?.monthly_price).toBe(4_950);
    expect(p(0)?.monthly_price).toBeUndefined();
    expect(p(-5)?.monthly_price).toBeUndefined();
    expect(p("4950")?.monthly_price).toBeUndefined();
  });
});
