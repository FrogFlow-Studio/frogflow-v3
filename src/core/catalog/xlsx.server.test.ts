import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { parseCatalogCsv } from "./import";
import { xlsxToCsv } from "./xlsx.server";

/** Собирает минимальный zip (deflate) — .xlsx из тестовых XML без внешних библиотек. */
function zip(files: Record<string, string>): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const data = deflateRawSync(Buffer.from(text, "utf8"));
    const nm = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(Buffer.byteLength(text), 22);
    local.writeUInt16LE(nm.length, 26);
    parts.push(local, nm, data);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(8, 10);
    c.writeUInt32LE(data.length, 20);
    c.writeUInt32LE(Buffer.byteLength(text), 24);
    c.writeUInt16LE(nm.length, 28);
    c.writeUInt32LE(offset, 42);
    central.push(c, nm);
    offset += 30 + nm.length + data.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, end]);
}

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
});
