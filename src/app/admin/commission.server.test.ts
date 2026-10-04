import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";

/** Страница «Комиссия»: месяцы по поясу магазина, выключатель, подсказка, договорной тариф. */
let db: FakeDb;
vi.mock("@/core/db/client.server", () => ({ serviceDb: () => db, tenantDb: () => db }));

const { commissionPage, previousMonth } = await import("./commission.server");

const ctx = (plan: string | null) =>
  ({
    db,
    timezone: "Asia/Almaty",
    tenant: { id: "b1", plan, settings: {} },
  }) as unknown as TenantContext;
const NOW = new Date("2027-03-15T10:00:00Z");

let n = 0;
const order = (over: Record<string, unknown>) =>
  db.tables.orders!.push({
    id: ++n,
    bot_id: "b1",
    platform: "web",
    status: "paid",
    total: 100_000,
    paid_amount: 0,
    fulfillment_kind: "digital",
    currency: "KZT",
    created_at: "2027-03-10T10:00:00Z",
    ...over,
  });

beforeEach(() => {
  db = fakeDb();
  db.tables.orders = [];
  db.tables.operator_settings = [];
  n = 0;
});

it("предыдущий месяц, в том числе через границу года", () => {
  expect(previousMonth("2027-03")).toBe("2027-02");
  expect(previousMonth("2027-01")).toBe("2026-12");
});

describe("страница", () => {
  it("выключатель выкл.: продажи видны, комиссия ноль, подсказки нет", async () => {
    order({ total: 400_000 });
    const p = await commissionPage(ctx("flowers.basic"), NOW);
    expect(p).toMatchObject({ enabled: false, tier: "basic", start: "2027-01-01" });
    expect(p.current).toMatchObject({
      month: "2027-03",
      sales: 400_000,
      commission: 0,
      reason: "switch_off",
    });
    expect(p.advice).toBeNull();
  });

  it("включён: комиссия за этот и прошлый месяц, подсказка по месяцу с большими продажами", async () => {
    db.tables.operator_settings = [
      { key: "v3_commission", value: JSON.stringify({ enabled: true }) },
    ];
    order({ total: 100_000 });
    order({ total: 500_000, created_at: "2027-02-10T10:00:00Z" });
    const p = await commissionPage(ctx("flowers.basic"), NOW);
    expect(p.current).toMatchObject({ sales: 100_000, commission: 5_000 });
    expect(p.previous).toMatchObject({ month: "2027-02", sales: 500_000, commission: 45_000 });
    expect(p.advice).toMatchObject({ month: "2027-02", tier: "pro" });
  });

  it("заказ из бота страницу не меняет", async () => {
    db.tables.operator_settings = [
      { key: "v3_commission", value: JSON.stringify({ enabled: true }) },
    ];
    order({ platform: "telegram", total: 900_000 });
    const p = await commissionPage(ctx("flowers.basic"), NOW);
    expect(p.current.sales).toBe(0);
    expect(p.advice).toBeNull();
  });

  it("договорной тариф: комиссии и подсказки нет", async () => {
    db.tables.operator_settings = [
      { key: "v3_commission", value: JSON.stringify({ enabled: true }) },
    ];
    order({ total: 900_000 });
    const p = await commissionPage(ctx("custom"), NOW);
    expect(p).toMatchObject({ tier: null, advice: null });
    expect(p.current).toMatchObject({ commission: 0, reason: "no_rate" });
  });
});
