import { describe, expect, it } from "vitest";
import {
  detectDelimiter,
  matchColumns,
  parseBool,
  parseCatalogCsv,
  parseCsv,
  parsePrice,
  planImport,
  MAX_IMPORT_ROWS,
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
      "Цвет",
    ]);
    expect(map.name).toBe(0);
    expect(map.price).toBeUndefined(); // «Цена, ₸» — не точный заголовок
    expect(map.category).toBe(2);
    expect(map.fileUrlKz).toBe(3);
    expect(map.sku).toBe(4);
    expect(unknown).toEqual(["Цена, ₸", "Цвет"]);
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
        sku: null,
        photos: null,
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
    expect(plan.create.map((c) => c.name)).toEqual(["новый", "y"]);
    // «курс а» уже обновляется строкой «КУРС а»: второго товара не создаём
    expect(plan.repeats.map((c) => c.name)).toEqual(["курс а"]);
    expect(plan.unmatchedIds.map((c) => c.name)).toEqual(["y"]);
  });

  it("артикул ищется раньше названия: переименованный товар не задваивается", () => {
    const d = (name: string, sku: string | null) =>
      ({
        line: 1,
        id: null,
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
        sku,
        photos: null,
      }) as const;
    const plan = planImport(
      [d("Новое имя", "ab-1"), d("Другой", "zz-9")],
      [{ id: "p1", name: "Старое имя" }],
      new Map([
        ["ab-1", "p1"],
        ["zz-9", "удалённый-товар"], // привязка к товару, которого уже нет, — новый товар
      ]),
    );
    expect(plan.update.map((u) => [u.id, u.by])).toEqual([["p1", "sku"]]);
    expect(plan.create.map((c) => c.name)).toEqual(["Другой"]);
  });
});

describe("артикул, фото, повторы и размер файла", () => {
  it("ошибка строки не ломает остальные; повтор в файле пропускается с объяснением", () => {
    const r = parseCatalogCsv(
      [
        "Артикул;Название;Цена;Фото",
        "A-1;Первый;100;https://cdn.example/a.jpg",
        "a-1;Тот же артикул;200;",
        ";Без цены;abc;",
        ";Без цены;;",
        "B-2;Второй;300;http://cdn.example/b.jpg https://cdn.example/c.png",
      ].join("\n"),
    );
    expect(r.drafts.map((d) => [d.line, d.sku])).toEqual([
      [2, "a-1"],
      [5, null],
      [6, "b-2"],
    ]);
    expect(r.errors.map((e) => e.line)).toEqual([3, 4]);
    expect(r.errors[0]!.message).toMatch(/строке 2/);
    expect(r.drafts[0]!.photos).toEqual(["https://cdn.example/a.jpg"]);
    // http-ссылка не берётся, но строка принята
    expect(r.drafts[2]!.photos).toEqual(["https://cdn.example/c.png"]);
    expect(r.warnings.map((w) => w.line)).toEqual([6]);
  });

  it("колонки «Фото» нет — photos: null; пустая ячейка — пустой список", () => {
    expect(parseCatalogCsv("Название\nA").drafts[0]!.photos).toBeNull();
    expect(parseCatalogCsv("Название;Фото\nA;").drafts[0]!.photos).toEqual([]);
  });

  it("не больше пяти фото на товар, лишние в предупреждении", () => {
    const links = Array.from({ length: 7 }, (_, i) => `https://cdn.example/${i}.jpg`).join(" ");
    const r = parseCatalogCsv(`Название;Фото\nA;${links}`);
    expect(r.drafts[0]!.photos).toHaveLength(5);
    expect(r.warnings).toHaveLength(1);
  });

  it("файл длиннее лимита режется явно: ошибка называет, сколько не взято", () => {
    const rows = Array.from({ length: MAX_IMPORT_ROWS + 3 }, (_, i) => `Товар ${i}`);
    const text = ["Название", ...rows].join("\n");
    expect(parseCatalogCsv(text).drafts).toHaveLength(MAX_IMPORT_ROWS + 3); // таблица по ссылке — без потолка
    const r = parseCatalogCsv(text, { maxRows: MAX_IMPORT_ROWS });
    expect(r.drafts).toHaveLength(MAX_IMPORT_ROWS);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]!.message).toContain(String(MAX_IMPORT_ROWS + 3));
  });
});
