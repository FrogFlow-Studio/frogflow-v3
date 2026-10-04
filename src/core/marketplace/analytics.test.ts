import { describe, expect, it } from "vitest";
import { cleanQuery, dedupeKey, hourBucket, summarize } from "./analytics";

describe("аналитика площадки: чистые функции", () => {
  it("час округляется вниз, один и тот же для всей часа", () => {
    const a = Date.UTC(2026, 9, 4, 10, 5);
    const b = Date.UTC(2026, 9, 4, 10, 59);
    expect(hourBucket(a)).toBe(hourBucket(b));
    expect(hourBucket(a)).toBe("2026-10-04T10:00:00.000Z");
  });

  it("устройство в пределах часа даёт один ключ, в другой час и с другого устройства — другой", () => {
    const h1 = hourBucket(Date.UTC(2026, 9, 4, 10, 5));
    const h2 = hourBucket(Date.UTC(2026, 9, 4, 11, 5));
    const k = dedupeKey("s", h1, "1.1.1.1", "UA");
    expect(dedupeKey("s", h1, "1.1.1.1", "UA")).toBe(k);
    expect(dedupeKey("s", h2, "1.1.1.1", "UA")).not.toBe(k);
    expect(dedupeKey("s", h1, "2.2.2.2", "UA")).not.toBe(k);
    // В ключе нет ни адреса, ни браузера.
    expect(k).not.toContain("1.1.1.1");
    expect(k).toMatch(/^[0-9a-f]{32}$/);
  });

  it("запрос: нижний регистр, пробелы, обрезка, не строка — пусто", () => {
    expect(cleanQuery("  Торты   НА заказ ")).toBe("торты на заказ");
    expect(cleanQuery("x".repeat(200))).toHaveLength(80);
    expect(cleanQuery(42)).toBe("");
  });

  it("сводка считает по видам и сортирует равные по алфавиту", () => {
    const s = summarize([
      { kind: "visit", key: "" },
      { kind: "visit", key: "" },
      { kind: "search", key: "торт" },
      { kind: "search", key: "торт" },
      { kind: "search", key: "арт" },
      { kind: "empty", key: "курсы" },
      { kind: "click", key: "b1" },
      { kind: "click", key: "b1" },
      { kind: "click", key: "b2" },
    ]);
    expect(s).toMatchObject({ visits: 2, searches: 3, clicks: 3 });
    expect(s.topSearches).toEqual([
      { query: "торт", count: 2 },
      { query: "арт", count: 1 },
    ]);
    expect(s.emptySearches).toEqual([{ query: "курсы", count: 1 }]);
    expect(s.clicksByShop.get("b1")).toBe(2);
  });
});
