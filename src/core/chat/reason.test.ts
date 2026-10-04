import { describe, expect, it } from "vitest";
import { REASON_MAX, cleanReason, makeReason, reasonPairs } from "./reason";

describe("причина ответа бота", () => {
  it("пары ключ=значение через пробел; пустое и ложное отбрасывается, true — «1»", () => {
    expect(makeReason({ step: "cart", parsed: "codes", skipped: undefined, stale: false })).toBe(
      "step=cart parsed=codes",
    );
    expect(makeReason({ cancel: true })).toBe("cancel=1");
    expect(makeReason({})).toBeNull();
    expect(makeReason({ step: "" })).toBeNull();
  });

  it("текст покупателя в причину не попадает: кириллица и пробелы вычищаются, значение короткое", () => {
    const r = makeReason({ parsed: "Привет, мой номер 87770637152!" })!;
    expect(r).toBe("parsed=87770637152");
    expect(makeReason({ parsed: "Привет, как дела" })).toBeNull();
    expect(makeReason({ step: "x".repeat(100) })).toBe(`step=${"x".repeat(24)}`);
  });

  it("не длиннее REASON_MAX: лишние пары пропадают с хвоста", () => {
    const many = Object.fromEntries(
      Array.from({ length: 40 }, (_, i) => [`k${i}`, "v".repeat(20)]),
    );
    const r = makeReason(many)!;
    expect(r.length).toBeLessThanOrEqual(REASON_MAX);
    expect(r.startsWith("k0=")).toBe(true);
  });

  it("cleanReason переразбирает строку из базы и отбрасывает мусор", () => {
    expect(cleanReason("step=cart  parsed=codes")).toBe("step=cart parsed=codes");
    expect(cleanReason("привет мир")).toBeNull();
    expect(cleanReason(null)).toBeNull();
    expect(cleanReason(42)).toBeNull();
  });

  it("пары для показа", () => {
    expect(reasonPairs("step=cart skipped=phone")).toEqual([
      { key: "step", value: "cart" },
      { key: "skipped", value: "phone" },
    ]);
    expect(reasonPairs(null)).toEqual([]);
  });
});
