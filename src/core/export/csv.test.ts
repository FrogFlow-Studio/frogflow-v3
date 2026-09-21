import { describe, expect, it } from "vitest";
import { BOM, cell, shopDateTime, toCsv, zonedDayToUtc } from "./csv";

describe("cell / toCsv", () => {
  it("экранирует разделитель, кавычки и переводы строк", () => {
    expect(cell("a;b")).toBe('"a;b"');
    expect(cell('он сказал "да"')).toBe('"он сказал ""да"""');
    expect(cell("две\nстроки")).toBe('"две\nстроки"');
    expect(cell(null)).toBe("");
    expect(cell(1500)).toBe("1500");
  });
  it("не даёт Excel исполнить формулу из имени покупателя", () => {
    expect(cell("=SUM(1)")).toBe("'=SUM(1)");
    expect(cell("-5")).toBe("'-5");
    expect(cell("@admin")).toBe("'@admin");
  });
  it("собирает файл с BOM и \\r\\n", () => {
    const csv = toCsv(["a", "b"], [[1, "x;y"]]);
    expect(csv.startsWith(BOM)).toBe(true);
    expect(csv.slice(1)).toBe('a;b\r\n1;"x;y"');
  });
});

describe("даты в поясе клиента", () => {
  it("shopDateTime переводит UTC в местное время", () => {
    expect(shopDateTime("2026-09-20T20:30:00Z", "Asia/Almaty")).toBe("2026-09-21 01:30");
    expect(shopDateTime(null, "UTC")).toBe("");
  });
  it("zonedDayToUtc даёт границы дня в UTC", () => {
    expect(zonedDayToUtc("2026-09-21", "Asia/Almaty")).toBe("2026-09-20T19:00:00.000Z");
    expect(zonedDayToUtc("2026-09-21", "Asia/Almaty", true)).toBe("2026-09-21T18:59:59.999Z");
    expect(zonedDayToUtc("2026-09-21", "UTC")).toBe("2026-09-21T00:00:00.000Z");
  });
});
