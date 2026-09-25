import { describe, expect, it } from "vitest";
import {
  detectDelimiter,
  matchColumns,
  parseBool,
  parseCatalogCsv,
  parseCsv,
  parsePrice,
  planImport,
} from "./import";

describe("parseCsv", () => {
  it("угадывает разделитель и понимает кавычки, CRLF и BOM", () => {
    expect(detectDelimiter("Название;Цена;Описание")).toBe(";");
    expect(detectDelimiter('name,"price, kzt",desc')).toBe(",");
    const rows = parseCsv('﻿Название;Цена\r\n"Курс ""А""";1 500\r\n"Много\nстрок";10\r\n\r\n');
    expect(rows).toEqual([
      ["Название", "Цена"],
      ['Курс "А"', "1 500"],
      ["Много\nстрок", "10"],
    ]);
  });
});

describe("matchColumns / значения", () => {
  it("русские и английские заголовки, неизвестные — отдельно", () => {
    const { map, unknown } = matchColumns([
      "Название",
      "Цена, ₸",
      "category",
      "Ссылка KZ",
      "Артикул",
    ]);
    expect(map.name).toBe(0);
    expect(map.price).toBeUndefined(); // «Цена, ₸» — не точный заголовок
    expect(map.category).toBe(2);
    expect(map.fileUrlKz).toBe(3);
    expect(unknown).toEqual(["Цена, ₸", "Артикул"]);
  });
  it("цена в любом формате, да/нет в любом виде", () => {
    expect(parsePrice("1 500,50 ₸")).toBe(1500.5);
    expect(parsePrice("1,500.50")).toBe(1500.5);
    expect(parsePrice("2000")).toBe(2000);
    expect(parsePrice("бесплатно")).toBeNull();
    expect(parseBool("Да")).toBe(true);
    expect(parseBool("0")).toBe(false);
    expect(parseBool("", false)).toBe(false);
    expect(parseBool("что-то")).toBe(true);
  });
});

describe("parseCatalogCsv", () => {
  it("строки с названием и разбираемой ценой — черновики; остальное — в ошибки со строкой", () => {
    const r = parseCatalogCsv(
      "Название;Цена;Категория;В продаже;Остаток;Тип\nКурс А;1500;Математика;да;;цифровой\n;100;;;;\nКурс Б;дорого;;нет;5;физический\nКурс В;;;;3;",
    );
    expect(r.drafts.map((d) => [d.name, d.price, d.category, d.active, d.stock, d.kind])).toEqual([
      ["Курс А", 1500, "Математика", true, null, "digital"],
      ["Курс В", null, null, true, 3, null],
    ]);
    expect(r.errors.map((e) => e.line)).toEqual([3, 4]);
    expect(r.fields).toContain("stock");
  });
  it("без колонки названия — понятная ошибка", () => {
    expect(parseCatalogCsv("Цена;Описание\n10;x").errors[0]!.message).toMatch(/Название/);
  });
});

describe("planImport", () => {
  it("по id — обновить, по названию без регистра — обновить один раз, иначе создать", () => {
    const d = (name: string, id: string | null = null) =>
      ({
        line: 1,
        id,
        name,
        price: null,
        currency: null,
        category: null,
        description: null,
        keywords: null,
        active: null,
        stock: undefined,
        fileUrl: null,
        fileUrlKz: null,
        sortOrder: null,
        kind: null,
      }) as const;
    const plan = planImport(
      [d("новый"), d("КУРС а"), d("курс а"), d("x", "id-1"), d("y", "id-missing")],
      [
        { id: "id-1", name: "Старый" },
        { id: "id-2", name: "Курс А" },
      ],
    );
    expect(plan.update.map((u) => [u.id, u.draft.name])).toEqual([
      ["id-2", "КУРС а"],
      ["id-1", "x"],
    ]);
    expect(plan.create.map((c) => c.name)).toEqual(["новый", "курс а", "y"]);
    expect(plan.unmatchedIds.map((c) => c.name)).toEqual(["y"]);
  });
});
