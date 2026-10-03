import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";

let db: FakeDb;
vi.mock("@/core/db/client.server", () => ({ serviceDb: () => db }));
const { billingHistory, HISTORY_PAGE } = await import("./billing-history.server");

const MINE = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";

beforeEach(() => {
  db = fakeDb();
  db.tables.subscription_payments = Array.from({ length: 23 }, (_, i) => ({
    id: `p${String(i).padStart(2, "0")}`,
    bot_id: MINE,
    period_start: "2026-01-01",
    period_end: "2026-02-01",
    amount: "19900",
    currency: "KZT",
    paid_at: "2026-01-01T00:00:00Z",
    note: "служебная заметка оператора",
    created_at: "2026-01-01T00:00:00Z",
  }));
  db.tables.subscription_payments.push({
    id: "px",
    bot_id: OTHER,
    period_start: "2026-01-01",
    period_end: "2026-02-01",
    amount: 1,
    currency: "KZT",
    paid_at: "2026-01-01T00:00:00Z",
    note: null,
    created_at: "2026-01-01T00:00:00Z",
  });
  db.tables.subscription_invoices = [
    {
      id: "i1",
      bot_id: MINE,
      amount: 19900,
      currency: "KZT",
      note: null,
      requisites_snapshot: "ИИН 123, Kaspi Gold",
      status: "rejected",
      proof_path: "proof/1.jpg",
      proof_uploaded_at: null,
      created_at: "2026-02-01T00:00:00Z",
      created_by: "op",
      confirmed_at: null,
      reject_reason: "Сумма не совпала",
    },
  ];
});

describe("история оплат продавца", () => {
  it("постранично и без потерь: с равными датами страницы не пересекаются, всего — 23", async () => {
    const seen: string[] = [];
    for (let page = 0; page < 3; page++) {
      const r = await billingHistory(MINE, "payments", page);
      expect(r.total).toBe(23);
      expect(r.rows.length).toBe(page < 2 ? HISTORY_PAGE : 3);
      seen.push(...r.rows.map((x) => x.id));
    }
    expect(new Set(seen).size).toBe(23);
    expect(seen).not.toContain("px");
  });

  it("продавцу не уходят заметки оператора, реквизиты и чек; причина отказа — уходит", async () => {
    const pay = await billingHistory(MINE, "payments", 0);
    expect(pay.rows[0]).not.toHaveProperty("note");
    expect(pay.rows[0]!.amount).toBe(19900);
    const inv = await billingHistory(MINE, "invoices", 0);
    expect(inv.rows[0]).toMatchObject({ status: "rejected", reject_reason: "Сумма не совпала" });
    expect(JSON.stringify(inv.rows)).not.toMatch(/Kaspi Gold|proof|created_by/);
  });

  it("чужой магазин пуст, отрицательная страница — первая", async () => {
    expect(
      (await billingHistory("33333333-3333-3333-3333-333333333333", "invoices", 0)).total,
    ).toBe(0);
    expect((await billingHistory(MINE, "payments", -5)).page).toBe(0);
  });
});
