import { describe, expect, it } from "vitest";
import { SUPPORTED_LOCALES } from "@/core/i18n/locale";
import { AUTHOR_KEYS, authorT } from "./i18n";

describe("страница автора и «Рекомендуем»: 4 языка", () => {
  it("каждый ключ переведён на каждом языке", () => {
    for (const l of SUPPORTED_LOCALES)
      for (const k of AUTHOR_KEYS) {
        expect(authorT(l)(k), `${l}: ${k}`).toBeTruthy();
        if (l !== "ru" && k !== "niche.city")
          expect(authorT(l)(k), `${l}: ${k}`).not.toBe(authorT("ru")(k));
      }
  });
  it("подставляет значения", () => {
    expect(authorT("en")("rating", { rating: "4.8", count: 12 })).toBe(
      "Buyer rating: 4.8 out of 5, ratings: 12",
    );
  });
});
