import { describe, expect, it } from "vitest";
import { allReady, cleanEndsAt, cleanTerms, cleanTitle, jointEffective } from "./joint";

const now = new Date("2026-10-04T12:00:00Z");

describe("совместные акции: правила", () => {
  it("условия: код приводится к верхнему регистру, скидка — целое 1–90", () => {
    expect(cleanTerms({ code: " duo-10 ", percent: 10, conditions: "  от 5000  " })).toEqual({
      ok: true,
      value: { code: "DUO-10", percent: 10, conditions: "от 5000" },
    });
    expect(cleanTerms({ code: "ab", percent: 10 })).toEqual({ ok: false, error: "code" });
    expect(cleanTerms({ code: "a b c", percent: 10 })).toEqual({ ok: false, error: "code" });
    expect(cleanTerms({ code: "OKAY", percent: 0 })).toEqual({ ok: false, error: "percent" });
    expect(cleanTerms({ code: "OKAY", percent: 91 })).toEqual({ ok: false, error: "percent" });
    expect(cleanTerms({ code: "OKAY", percent: 12.5 })).toEqual({ ok: false, error: "percent" });
    expect(cleanTerms(null)).toEqual({ ok: false, error: "code" });
  });
  it("название и дата окончания", () => {
    expect(cleanTitle("  Весенний   дуэт ")).toBe("Весенний дуэт");
    expect(cleanTitle("ab")).toBeNull();
    expect(cleanEndsAt("2026-10-10T00:00:00Z", now)).toBeInstanceOf(Date);
    expect(cleanEndsAt("2026-10-01T00:00:00Z", now)).toBeNull();
    expect(cleanEndsAt("2028-01-01T00:00:00Z", now)).toBeNull();
    expect(cleanEndsAt("не дата", now)).toBeNull();
  });
  it("статус: окончание считается по времени", () => {
    expect(jointEffective({ status: "active", ends_at: "2026-10-05T00:00:00Z" }, now)).toBe(
      "active",
    );
    expect(jointEffective({ status: "active", ends_at: "2026-10-04T11:00:00Z" }, now)).toBe(
      "ended",
    );
    expect(jointEffective({ status: "proposed", ends_at: "2026-10-05T00:00:00Z" }, now)).toBe(
      "proposed",
    );
    expect(jointEffective({ status: "cancelled", ends_at: "2026-10-05T00:00:00Z" }, now)).toBe(
      "cancelled",
    );
  });
  it("готовность: согласились все и у каждого есть код", () => {
    const ok = { status: "accepted", promo_code_id: "c" };
    expect(allReady([ok, ok])).toBe(true);
    expect(allReady([ok, { status: "invited", promo_code_id: null }])).toBe(false);
    expect(allReady([ok, { status: "accepted", promo_code_id: null }])).toBe(false);
    expect(allReady([ok])).toBe(false);
  });
});
