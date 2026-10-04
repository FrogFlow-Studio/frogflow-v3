import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import { settingsFromJson } from "@/core/tenant/directory";

/**
 * Комиссия платформы строкой в счёте за подписку (К3) настоящим кодом
 * выставления счёта и закрепления месяца: выключатель, «один раз» при гонке,
 * освобождение месяца у отменённого счёта, клиент прежней платформы.
 */
let db: FakeDb;
// Подключение уже оплачено: в счёте только подписка (9 900 ₸) и комиссия.
const V2 = { served_by: "v2", billing: { connection_paid_at: "2027-01-01T00:00:00Z" } };
const BOT = "00000000-0000-0000-0000-0000000000c3";

vi.mock("@/core/db/client.server", () => ({ serviceDb: () => db, tenantDb: () => db }));
vi.mock("@/lib/errors", () => ({ reportError: async () => {} }));
vi.mock("./operator.server", () => ({
  logEvent: async () => {},
  notifyOwner: async () => ({ delivered: ["owner"], failed: [] }),
}));
vi.mock("@/core/tenant/resolve.server", async (orig) => {
  const real = await orig<typeof import("@/core/tenant/resolve.server")>();
  const tenantOf = () => {
    const b = db.tables.bots!.find((x) => x.id === BOT)!;
    return {
      id: BOT,
      name: "Магазин",
      plan: b.plan,
      vertical: null,
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

let n = 0;
const web = (total: number, createdAt = "2027-02-10T10:00:00Z", over = {}) =>
  db.tables.orders!.push({
    id: ++n,
    bot_id: BOT,
    platform: "web",
    status: "paid",
    total,
    paid_amount: 0,
    fulfillment_kind: "digital",
    currency: "KZT",
    created_at: createdAt,
    ...over,
  });

const settingsOf = () => db.tables.bots!.find((b) => b.id === BOT)!.settings as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const invoices = () => db.tables.subscription_invoices!;
const commissionLines = (note: unknown) =>
  String(note ?? "")
    .split("; ")
    .filter((l) => l.startsWith("Комиссия платформы"));
const create = () => plans.createPlanInvoice(BOT, { period: "month", addonPrices: {} }, "operator");

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2027-03-05T10:00:00Z"));
  db = fakeDb();
  // Значения по умолчанию счетов, как в схеме.
  const from = db.from.bind(db);
  db.from = ((table: string) => {
    const q = from(table) as unknown as Record<string, (...a: unknown[]) => unknown>;
    if (table === "subscription_invoices") {
      const insert = q.insert!.bind(q);
      q.insert = (r) =>
        insert({
          status: "sent",
          proof_path: null,
          proof_uploaded_at: null,
          confirmed_at: null,
          reject_reason: null,
          created_at: new Date().toISOString(),
          ...(r as object),
        });
    }
    return q as never;
  }) as typeof db.from;
  db.tables.operator_settings = [];
  db.tables.subscription_invoices = [];
  db.tables.subscription_payments = [];
  db.tables.orders = [];
  db.tables.zernio_logs = [];
  db.tables.bots = [{ id: BOT, plan: "flowers.basic", settings: { ...V2, rev: 1 } }];
  n = 0;
  await billing.setPayoutRequisites("Kaspi Gold 4400 0000 0000 0000, Иван И.");
  await setCommissionEnabled(true);
  // Февраль: 150 000 ₸ с витрины → 100 000 сверх порога × 10 % = 10 000 ₸.
  web(150_000);
});
afterEach(() => vi.useRealTimers());

describe("комиссия в счёте за подписку", () => {
  it("выключатель выключен — в счёте только подписка, месяц не закрепляется", async () => {
    await setCommissionEnabled(false);
    const r = await create();
    expect(r.invoice.amount).toBe(9_900);
    expect(commissionLines(r.invoice.note)).toEqual([]);
    expect(settingsOf().commission).toBeUndefined();
  });

  it("включён — строка за февраль с суммой в тенге, месяц закреплён за счётом", async () => {
    const r = await create();
    expect(r.invoice.amount).toBe(9_900 + 10_000);
    expect(commissionLines(r.invoice.note)).toEqual([
      "Комиссия платформы за 02.2027 (10 % с продаж 150 000 ₸ сверх 50 000 ₸): 10000 ₸",
    ]);
    expect(settingsOf().commission.billed).toEqual({ "2027-02": r.invoice.id });
    // Чужие ключи settings на месте, версия выросла.
    expect(settingsOf().served_by).toBe("v2");
    expect(settingsOf().rev).toBeGreaterThan(1);
  });

  it("следующий счёт того же месяца — без комиссии: один раз", async () => {
    const a = await create();
    const b = await create();
    expect(commissionLines(a.invoice.note)).toHaveLength(1);
    expect(b.invoice.amount).toBe(9_900);
    expect(commissionLines(b.invoice.note)).toEqual([]);
  });

  it("гонка: два счёта разом — комиссия в одном, второй без неё", async () => {
    const [a, b] = await Promise.all([create(), create()]);
    const withLine = [a, b].filter((r) => commissionLines(r.invoice.note).length);
    expect(withLine).toHaveLength(1);
    const live = invoices().filter((i) => i.status !== "cancelled");
    expect(live.filter((i) => commissionLines(i.note).length)).toHaveLength(1);
    expect(settingsOf().commission.billed["2027-02"]).toBe(withLine[0]!.invoice.id);
    // Проигравший проверил закрепление, не получил месяц и выставил счёт заново без строки.
    const lost = invoices().filter((i) => i.status === "cancelled");
    expect(lost).toHaveLength(1);
    expect(commissionLines(lost[0]!.note)).toHaveLength(1);
    expect(invoices()).toHaveLength(3);
  });

  it("счёт отменён или отклонён — месяц свободен и входит в следующий счёт", async () => {
    const a = await create();
    await billing.cancelInvoice(a.invoice.id, "operator");
    const b = await create();
    expect(commissionLines(b.invoice.note)).toHaveLength(1);
    await billing.rejectInvoice(b.invoice.id, "не тот чек", "operator");
    const c = await create();
    expect(commissionLines(c.invoice.note)).toHaveLength(1);
    expect(settingsOf().commission.billed["2027-02"]).toBe(c.invoice.id);
  });

  it("оплаченный счёт месяц не освобождает", async () => {
    const a = await create();
    await billing.confirmInvoice(
      a.invoice.id,
      { start: "2027-03-05", end: "2027-04-05" },
      "operator",
    );
    const b = await create();
    expect(commissionLines(b.invoice.note)).toEqual([]);
  });

  it("продажи до порога — строки нет и месяц не закрепляется", async () => {
    db.tables.orders = [];
    web(40_000);
    const r = await create();
    expect(r.invoice.amount).toBe(9_900);
    expect(settingsOf().commission).toBeUndefined();
  });

  it("заказ бота комиссии не несёт, возврат уменьшает базу", async () => {
    web(500_000, "2027-02-11T10:00:00Z", { platform: "telegram" });
    const id = web(60_000);
    db.tables.zernio_logs!.push({
      id: "e1",
      bot_id: BOT,
      status: "event",
      event_type: "order.refund",
      created_at: "2027-02-20T10:00:00Z",
      payload: { order_id: id, amount: 60_000 },
    });
    const r = await create();
    // 150 000 + 60 000 − 60 000 возврат = 150 000 → 10 000.
    expect(r.invoice.amount).toBe(9_900 + 10_000);
  });

  it("дата начала в марте — февраль не облагается", async () => {
    db.tables.bots![0]!.settings = { ...V2, rev: 1, commission: { start: "2027-03-01" } };
    const r = await create();
    expect(r.invoice.amount).toBe(9_900);
  });

  it("клиент прежней платформы: счёт как раньше, настройки не тронуты", async () => {
    db.tables.bots![0]!.settings = { rev: 1 };
    await expect(create()).rejects.toThrow(/v1/);
    expect(invoices()).toHaveLength(0);
    expect(settingsOf()).toEqual({ rev: 1 });
  });

  it("предпросмотр показывает ту же комиссию, что счёт, и ничего не закрепляет", async () => {
    const t = (await (await import("@/core/tenant/resolve.server")).tenantDirectory(true))[0]!;
    const q = await plans.planInvoiceQuote(t, {}, "month");
    expect(q.amount).toBe(19_900);
    expect(q.commissionMonths).toEqual(["2027-02"]);
    expect(settingsOf().commission).toBeUndefined();
  });
});

describe("месяцы к счёту", () => {
  it("от даты начала до прошлого месяца, не глубже года; текущий месяц не входит", async () => {
    const { billableMonths } = await import("@/core/commission/invoice.server");
    const now = new Date("2027-03-05T10:00:00Z");
    expect(billableMonths("2027-01-01", now, "Asia/Almaty")).toEqual(["2027-01", "2027-02"]);
    expect(billableMonths("2027-03-01", now, "Asia/Almaty")).toEqual([]);
    const far = billableMonths("2020-01-01", now, "Asia/Almaty");
    expect(far).toHaveLength(12);
    expect(far[0]).toBe("2026-03");
    expect(far.at(-1)).toBe("2027-02");
    // 1 марта 00:30 по Алматы — это ещё 28 февраля UTC: месяц уже март.
    expect(billableMonths("2027-01-01", new Date("2027-02-28T19:30:00Z"), "Asia/Almaty")).toEqual([
      "2027-01",
      "2027-02",
    ]);
  });
});
