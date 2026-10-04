import { describe, expect, it } from "vitest";
import { SUPPORTED_LOCALES } from "@/core/i18n/locale";
import { MARKET_KEYS, marketT } from "./i18n";

describe("словарь площадки", () => {
  it("каждый ключ переведён на каждом языке", () => {
    for (const l of SUPPORTED_LOCALES) {
      const t = marketT(l);
      for (const k of MARKET_KEYS) {
        expect(t(k), `${l}: ${k}`).toBeTruthy();
        if (l !== "ru" && !["filter.all", "search.button"].includes(k))
          expect(t(k), `${l}: ${k}`).not.toBe(marketT("ru")(k));
      }
    }
  });
  it("подставляет значения", () => {
    expect(marketT("en")("rating.count", { rating: "4.5", count: 3 })).toBe(
      "4.5 out of 5, ratings: 3",
    );
  });
});
