import { describe, expect, it } from "vitest";
import { SUPPORTED_LOCALES } from "@/core/i18n/locale";
import { FAVORITE_KEYS, favoriteT } from "./favorite-i18n";

describe("словарь избранного площадки", () => {
  it("каждый ключ переведён на каждом языке", () => {
    for (const l of SUPPORTED_LOCALES)
      for (const k of FAVORITE_KEYS) {
        expect(favoriteT(l)(k), `${l}: ${k}`).toBeTruthy();
        if (l !== "ru") expect(favoriteT(l)(k), `${l}: ${k}`).not.toBe(favoriteT("ru")(k));
      }
  });
  it("подставляет число", () => {
    expect(favoriteT("en")("gone", { n: 3 })).toContain("3");
  });
});
