import { describe, expect, it } from "vitest";
import { settingsFromJson } from "@/core/tenant/directory";
import { isOffHours, offHoursNote, pricelistHours, pricelistMode } from "./mode";

describe("режим консультанта по прайсу", () => {
  it("без флага — общий консультант, с флагом — по прайсу", () => {
    expect(pricelistMode({ settings: settingsFromJson({}) })).toBe(false);
    const s = settingsFromJson({
      consultant_pricelist: { enabled: true, hours: { open: 10, close: 21 }, rate_source: "vtb" },
    });
    expect(pricelistMode({ settings: s })).toBe(true);
    expect(s.consultant_pricelist).toEqual({
      enabled: true,
      hours: { open: 10, close: 21 },
      rate_source: "vtb",
    });
  });

  it("мусор в часах и источнике курса отбрасывается", () => {
    const s = settingsFromJson({
      consultant_pricelist: { enabled: true, hours: { open: 25, close: 3 }, rate_source: "cbr" },
    });
    expect(s.consultant_pricelist).toEqual({ enabled: true });
  });

  it("нерабочие часы — по поясу магазина, как isOffHoursInAlmaty у v1", () => {
    const hours = pricelistHours({ settings: settingsFromJson({}) });
    expect(hours).toEqual({ open: 10, close: 21 });
    const at = (utc: string) => new Date(`2026-09-25T${utc}:00Z`);
    // Алматы — UTC+5: 06:00 UTC = 11:00, 16:30 UTC = 21:30, 04:00 UTC = 09:00.
    expect(isOffHours(at("06:00"), hours, "Asia/Almaty")).toBe(false);
    expect(isOffHours(at("16:30"), hours, "Asia/Almaty")).toBe(true);
    expect(isOffHours(at("04:00"), hours, "Asia/Almaty")).toBe(true);
    expect(offHoursNote(hours)).toContain("с 21:00 до 10:00");
  });

  it("свои часы продавца, в том числе через полночь", () => {
    const night = { open: 18, close: 2 };
    const s = settingsFromJson({ consultant_pricelist: { enabled: true, hours: night } });
    expect(pricelistHours({ settings: s })).toEqual(night);
    expect(isOffHours(new Date("2026-09-25T18:00:00Z"), night, "UTC")).toBe(false);
    expect(isOffHours(new Date("2026-09-25T01:00:00Z"), night, "UTC")).toBe(false);
    expect(isOffHours(new Date("2026-09-25T12:00:00Z"), night, "UTC")).toBe(true);
  });
});
