import { describe, expect, it } from "vitest";
import { SUPPORTED_LOCALES } from "@/core/i18n/locale";
import { REPORT_REASONS } from "@/core/marketplace/report";
import { REPORT_KEYS, reportT } from "./report-i18n";

describe("словарь жалобы", () => {
  it("каждый ключ переведён на каждом языке", () => {
    for (const l of SUPPORTED_LOCALES)
      for (const k of REPORT_KEYS) {
        expect(reportT(l)(k), `${l}: ${k}`).toBeTruthy();
        if (l !== "ru") expect(reportT(l)(k), `${l}: ${k}`).not.toBe(reportT("ru")(k));
      }
  });
  it("у каждой причины есть подпись, а у ответа сервера — текст", () => {
    for (const r of REPORT_REASONS) expect(REPORT_KEYS).toContain(`reason.${r}`);
    for (const e of ["text", "unknown", "ip", "refresh", "fast"])
      expect(REPORT_KEYS).toContain(`err.${e}`);
  });
  it("подставляет значения", () => {
    expect(reportT("en")("about.product", { shop: "A", product: "B" })).toBe("Shop: A. Product: B");
  });
});
