import { describe, expect, it } from "vitest";
import { settingsFromJson } from "@/core/tenant/directory";
import { pricelistMode } from "./mode";

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
});
