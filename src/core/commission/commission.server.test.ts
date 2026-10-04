import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";

/** Комиссия на базе в памяти: часовой пояс, возвраты, страницы, выключатель по умолчанию выкл. */
let db: FakeDb;
vi.mock("@/core/db/client.server", () => ({ serviceDb: () => db, tenantDb: () => db }));

const { commissionForMonth, commissionEnabled, setCommissionEnabled } =
  await import("./commission.server");

const ctx = (plan = "flowers.basic", start?: string) =>
  ({
    db,
    timezone: "Asia/Almaty",
    tenant: { id: "b1", plan, settings: start ? { commission: { start } } : {} },
  }) as unknown as TenantContext;

let n = 0;
function order(over: Record<string, unknown>) {
  db.tables.orders!.push({
    id: ++n,
    bot_id: "b1",
    platform: "web",
    status: "paid",
    total: 100_000,
    paid_amount: 0,
    fulfillment_kind: "digital",
    currency: "KZT",
    created_at: "2027-02-10T10:00:00Z",
    ...over,
  });
  return n;
}

beforeEach(() => {
  db = fakeDb();
  db.tables.orders = [];
  n = 0;
});

describe("заказы месяца из базы", () => {
  it("месяц — по поясу магазина: 31 января 20:00 UTC в Алматы уже 1 февраля, 28 февраля 19:00 UTC — уже март", async () => {
    order({ created_at: "2027-01-31T20:00:00Z" });
    order({ created_at: "2027-02-28T18:59:00Z" });
    order({ created_at: "2027-02-28T19:00:00Z" });
    const feb = await commissionForMonth(ctx(), "2027-02", true);
    expect(feb.orders).toBe(2);
    const mar = await commissionForMonth(ctx(), "2027-03", true);
    expect(mar.orders).toBe(1);
  });

  it("только web: заказы бота, Direct и ручные не читаются в базу", async () => {
    order({ platform: "telegram" });
    order({ platform: "instagram" });
    order({ platform: "manual" });
    order({});
    const r = await commissionForMonth(ctx(), "2027-02", true);
    expect(r).toMatchObject({ orders: 1, sales: 100_000, commission: 2_500 + 2_500 });
  });

  it("возврат по событию уменьшает продажи месяца", async () => {
    const id = order({});
    db.tables.zernio_logs = [
      {
        id: "e1",
        status: "event",
        event_type: "order.refund",
        created_at: "2027-02-12T10:00:00Z",
        payload: { order_id: id, amount: 40_000 },
      },
    ];
    const r = await commissionForMonth(ctx(), "2027-02", true);
    expect(r).toMatchObject({ sales: 60_000, commission: 1_000 });
  });

  it("больше тысячи заказов читаются постранично, ничего не теряется", async () => {
    db = fakeDb({ maxRows: 1000 });
    db.tables.orders = [];
    for (let i = 0; i < 1_250; i++) order({ total: 100 });
    const r = await commissionForMonth(ctx(), "2027-02", true);
    expect(r.orders).toBe(1_250);
    expect(r.sales).toBe(125_000);
  });

  it("выключатель выкл. — ноль, продажи видны", async () => {
    order({ total: 300_000 });
    expect(await commissionForMonth(ctx(), "2027-02", false)).toMatchObject({
      sales: 300_000,
      commission: 0,
      reason: "switch_off",
    });
  });

  it("дата начала клиента из settings", async () => {
    order({ total: 300_000 });
    const r = await commissionForMonth(ctx("flowers.pro", "2027-03-01"), "2027-02", true);
    expect(r).toMatchObject({ commission: 0, reason: "before_start" });
  });
});

describe("общий выключатель", () => {
  beforeEach(() => {
    db.tables.operator_settings = [];
  });
  it("по умолчанию выключен; включается и выключается оператором", async () => {
    expect(await commissionEnabled()).toBe(false);
    await setCommissionEnabled(true);
    expect(await commissionEnabled()).toBe(true);
    await setCommissionEnabled(false);
    expect(await commissionEnabled()).toBe(false);
  });
  it("мусор в значении — выключен, а не включён", async () => {
    db.tables.operator_settings = [{ key: "v3_commission", value: "{не json" }];
    expect(await commissionEnabled()).toBe(false);
    db.tables.operator_settings = [
      { key: "v3_commission", value: JSON.stringify({ enabled: "yes" }) },
    ];
    expect(await commissionEnabled()).toBe(false);
  });
  it("сбой чтения — ошибка наружу, не «выключен» молча", async () => {
    db = {
      from: () => ({
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: "boom" } }) }),
        }),
      }),
    } as unknown as FakeDb;
    await expect(commissionEnabled()).rejects.toThrow("не прочитан");
  });
});
