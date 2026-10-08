import { describe, expect, it } from "vitest";
import { parseCatalogCsv } from "./import";
import { xlsxToCsv } from "./xlsx.server";
import { zip } from "../../../tests/xlsx-zip";

const SHARED = `<sst><si><t>Артикул</t></si><si><t>Название</t></si><si><t>Цена</t></si>
<si><t>Фото</t></si><si><r><t>Торт </t></r><r><t>&amp; крем</t></r></si><si><t>https://cdn.example/a.jpg</t></si></sst>`;
const SHEET = `<worksheet><sheetData>
<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" t="s"><v>3</v></c></row>
<row r="2"><c r="A2" t="inlineStr"><is><t>A-1</t></is></c><c r="B2" t="s"><v>4</v></c><c r="C2"><v>1500.5</v></c><c r="D2" t="s"><v>5</v></c></row>
<row r="3"><c r="B3" t="inlineStr"><is><t>Без артикула</t></is></c><c r="C3"><f>100*2</f><v>200</v></c></row>
</sheetData></worksheet>`;

describe("xlsxToCsv", () => {
  const book = zip({ "xl/sharedStrings.xml": SHARED, "xl/worksheets/sheet1.xml": SHEET });

  it("лист Excel читается так же, как CSV: колонки, общие строки, формулы, пропущенные ячейки", () => {
    const r = parseCatalogCsv(xlsxToCsv(book));
    expect(r.errors).toEqual([]);
    expect(r.drafts.map((d) => [d.sku, d.name, d.price])).toEqual([
      ["a-1", "Торт & крем", 1500.5],
      [null, "Без артикула", 200],
    ]);
    expect(r.drafts[0]!.photos).toEqual(["https://cdn.example/a.jpg"]);
  });

  it("не-Excel файл — понятная ошибка, а не падение", () => {
    expect(() => xlsxToCsv(Buffer.from("это не zip"))).toThrow(/Excel/);
  });

  it("перевод строки в ячейке: singleLine — пробел; больше 5000 строк — ошибка, а не обрезка", () => {
    const cell = `<worksheet><sheetData>
<row r="1"><c r="A1" t="inlineStr"><is><t>Название</t></is></c></row>
<row r="2"><c r="A2" t="inlineStr"><is><t>Полотенце
70x140</t></is></c></row>
</sheetData></worksheet>`;
    const book2 = zip({ "xl/worksheets/sheet1.xml": cell });
    expect(xlsxToCsv(book2, { singleLine: true })).toBe("Название\nПолотенце 70x140");
    const rows = Array.from(
      { length: 5001 },
      (_, i) => `<row r="${i + 1}"><c r="A${i + 1}"><v>${i}</v></c></row>`,
    ).join("");
    const big = zip({
      "xl/worksheets/sheet1.xml": `<worksheet><sheetData>${rows}</sheetData></worksheet>`,
    });
    expect(() => xlsxToCsv(big)).toThrow(/5000/);
  });
});
