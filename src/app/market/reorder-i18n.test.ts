import { describe, expect, it } from "vitest";
import { SUPPORTED_LOCALES } from "@/core/i18n/locale";
import { REORDER_KEYS, reorderT } from "./reorder-i18n";

describe("словарь «Заказать снова» на площадке", () => {
  it("каждый ключ переведён на каждом языке", () => {
    for (const l of SUPPORTED_LOCALES)
      for (const k of REORDER_KEYS) {
        expect(reorderT(l)(k), `${l}: ${k}`).toBeTruthy();
        if (l !== "ru") expect(reorderT(l)(k), `${l}: ${k}`).not.toBe(reorderT("ru")(k));
      }
  });
});
