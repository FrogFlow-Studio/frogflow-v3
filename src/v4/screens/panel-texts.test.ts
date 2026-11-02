import { describe, expect, it } from "vitest";
import { PANEL_TEXTS } from "./panel-texts";

describe("строки «Сегодня (v4)»", () => {
  it("на каждом языке заполнены, kk и uz не скопированы с английского или русского", () => {
    for (const [k, v] of Object.entries(PANEL_TEXTS)) {
      for (const l of ["ru", "kk", "en", "uz"] as const) expect(v[l], `${l}: ${k}`).toBeTruthy();
      expect(v.kk, k).not.toBe(v.en);
      expect(v.uz, k).not.toBe(v.en);
      expect(v.uz, k).not.toBe(v.ru);
    }
  });
});
