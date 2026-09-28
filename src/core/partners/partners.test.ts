import { describe, expect, it } from "vitest";
import {
  cleanPartner,
  parsePartners,
  partnerReport,
  partnerToken,
  upsertPartner,
  verifyPartnerToken,
} from "./partners";

describe("партнёрская программа", () => {
  it("партнёр: код латиницей, имя, процент до 50", () => {
    expect(cleanPartner({ code: " Agency-1 ", name: "Агентство", percent: 20 })).toEqual({
      code: "agency-1",
      name: "Агентство",
      contact: "",
      percent: 20,
    });
    expect(cleanPartner({ code: "ab", name: "x", percent: 10 })).toBeNull();
    expect(cleanPartner({ code: "agency", name: "", percent: 10 })).toBeNull();
    expect(cleanPartner({ code: "agency", name: "x", percent: 60 })).toBeNull();
  });

  it("список без дублей и мусора; замена по коду", () => {
    const list = parsePartners(
      JSON.stringify([
        { code: "aaa", name: "A", percent: 10 },
        { code: "aaa", name: "A2", percent: 15 },
        { code: "!", name: "bad", percent: 1 },
      ]),
    );
    expect(list.map((p) => p.name)).toEqual(["A"]);
    expect(parsePartners("не json")).toEqual([]);
    const next = upsertPartner(list, { code: "aaa", name: "A3", contact: "", percent: 12 });
    expect(next).toHaveLength(1);
    expect(next[0]!.percent).toBe(12);
  });

  it("ссылка на отчёт подписана кодом партнёра", () => {
    const t = partnerToken("secret", "aaa");
    expect(verifyPartnerToken("secret", "aaa", t)).toBe(true);
    expect(verifyPartnerToken("secret", "bbb", t)).toBe(false);
    expect(verifyPartnerToken("other", "aaa", t)).toBe(false);
    expect(verifyPartnerToken("secret", "aaa", "")).toBe(false);
  });

  it("отчёт: только свои клиенты, суммы по месяцам и валютам, комиссия по проценту", () => {
    const r = partnerReport(
      { code: "aaa", name: "A", contact: "", percent: 20 },
      [
        { botId: "b1", name: "Магазин 1", plan: "Basic", since: null },
        { botId: "b2", name: "Магазин 2", plan: "Pro", since: null },
      ],
      [
        { bot_id: "b1", paid_at: "2026-08-03T00:00:00Z", amount: 10000, currency: "KZT" },
        { bot_id: "b2", paid_at: "2026-08-20T00:00:00Z", amount: 25000, currency: "kzt" },
        { bot_id: "b1", paid_at: "2026-09-03T00:00:00Z", amount: 10000, currency: "KZT" },
        { bot_id: "чужой", paid_at: "2026-09-03T00:00:00Z", amount: 99999, currency: "KZT" },
      ],
    );
    expect(r.clients.map((c) => c.paid)).toEqual([{ KZT: 20000 }, { KZT: 25000 }]);
    expect(r.months).toEqual([
      { month: "2026-09", currency: "KZT", paid: 10000, commission: 2000 },
      { month: "2026-08", currency: "KZT", paid: 35000, commission: 7000 },
    ]);
    expect(r.totals).toEqual([{ currency: "KZT", paid: 45000, commission: 9000 }]);
  });
});
