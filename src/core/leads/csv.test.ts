import { describe, expect, it } from "vitest";
import { MAX_IMPORT_ROWS, detectDelimiter, parseCsvRows, parseLeadsCsv } from "./csv";

describe("разбор CSV", () => {
  it("кавычки, запятая и перенос внутри поля, удвоенные кавычки", () => {
    expect(parseCsvRows('a,"b,1","c\n2","d ""x"""\n1,2,3,4', ",")).toEqual([
      ["a", "b,1", "c\n2", 'd "x"'],
      ["1", "2", "3", "4"],
    ]);
  });

  it("разделитель определяется по заголовку: ; из Excel и табуляция", () => {
    expect(detectDelimiter("Название;Город;Телефон")).toBe(";");
    expect(detectDelimiter("name\tcity")).toBe("\t");
    expect(detectDelimiter("name,city")).toBe(",");
  });
});

describe("parseLeadsCsv", () => {
  it("русские заголовки, BOM, любой порядок столбцов", () => {
    const r = parseLeadsCsv(
      "﻿Город;Название;Телефон;Instagram;Ниша\nАлматы;Кофейня «Утро»;+7 700 111 22 33;@utro.coffee;кофейни\n",
    );
    expect(r).toMatchObject({ ok: true, errors: [] });
    if (!r.ok) return;
    expect(r.leads).toHaveLength(1);
    expect(r.leads[0]).toMatchObject({
      line: 2,
      input: {
        businessName: "Кофейня «Утро»",
        city: "Алматы",
        phone: "77001112233",
        instagramHandle: "utro.coffee",
        niche: "кофейни",
      },
    });
  });

  it("строки без названия или без контакта попадают в ошибки с номером строки", () => {
    const r = parseLeadsCsv(
      "name,phone,email\nА,,\n,77001112233,\nБ,77001112233,\nВ,,v@example.com\n",
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.leads.map((l) => l.input.businessName)).toEqual(["Б", "В"]);
    expect(r.errors).toEqual([
      { line: 2, message: expect.stringContaining("нет рабочего контакта") },
      { line: 3, message: "нет названия" },
    ]);
  });

  it("нет столбца с названием, пустой файл, только заголовок — понятная ошибка", () => {
    expect(parseLeadsCsv("phone,city\n1,2")).toMatchObject({ ok: false });
    expect(parseLeadsCsv("")).toMatchObject({ ok: false, error: "Файл пустой" });
    expect(parseLeadsCsv("name,phone")).toMatchObject({ ok: false });
  });

  it("больше лимита строк — отказ целиком, а не тихая обрезка", () => {
    const body = Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => `Л${i},7700111${i}`);
    const r = parseLeadsCsv(["name,phone", ...body].join("\n"));
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.error).toContain(String(MAX_IMPORT_ROWS));
  });
});
