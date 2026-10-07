import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { zipFiles } from "@/core/export/zip";
import {
  decodeBase64,
  extractDocumentText,
  hasSectionMarkers,
  titleFromFileName,
  KNOWLEDGE_FILE_MAX_MB,
} from "./doc-text";
import { textFromDocumentXml } from "./docx-text";

/**
 * Текст из файла базы знаний (перенос tests/consultant-doc-text.test.ts v1,
 * имена дословно) и чтение Word без mammoth.
 */
const encode = (text: string) => new TextEncoder().encode(text);

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const para = (...runs: string[]) =>
  `<w:p><w:pPr><w:pStyle w:val="Normal"/></w:pPr>${runs.map((r) => `<w:r><w:t xml:space="preserve">${r}</w:t></w:r>`).join("")}</w:p>`;

function docx(body: string): Uint8Array {
  return new Uint8Array(
    zipFiles([
      { name: "[Content_Types].xml", data: "<Types/>" },
      {
        name: "word/document.xml",
        data: `<?xml version="1.0"?><w:document ${W}><w:body>${body}</w:body></w:document>`,
      },
    ]),
  );
}

async function pdf(lines: string[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 400]);
  if (lines.length) {
    const font = await doc.embedFont(StandardFonts.Helvetica);
    lines.forEach((l, i) => page.drawText(l, { x: 20, y: 360 - i * 20, size: 12, font }));
  }
  return doc.save();
}

describe("текст из файла базы знаний", () => {
  it("читает обычный текст и markdown", async () => {
    const res = await extractDocumentText(encode("## Уход\nСтирка при 40°C"), "care.md");
    expect(res).toEqual({ ok: true, text: "## Уход\nСтирка при 40°C" });
  });

  it("не принимает пустой файл", async () => {
    expect(await extractDocumentText(new Uint8Array(), "empty.txt")).toEqual({
      ok: false,
      error: "empty",
    });
  });

  it("узнаёт PDF по сигнатуре, даже если расширение другое", async () => {
    const notReallyAPdf = encode("%PDF-1.7\nтут не настоящий pdf");
    const res = await extractDocumentText(notReallyAPdf, "catalog.bin");
    // Главное — файл ушёл в ветку PDF и получил внятную ошибку,
    // а не был молча разобран как текст с бинарным мусором внутри.
    expect(res).toEqual({ ok: false, error: "pdfBroken" });
  });

  it("base64 читается и с префиксом data:, и без него", () => {
    const plain = Buffer.from("привет").toString("base64");
    expect(new TextDecoder().decode(decodeBase64(plain))).toBe("привет");
    expect(new TextDecoder().decode(decodeBase64(`data:text/plain;base64,${plain}`))).toBe(
      "привет",
    );
  });

  it("видит разделители статей", () => {
    expect(hasSectionMarkers("## Первая\nтекст\n---\n## Вторая")).toBe(true);
    expect(hasSectionMarkers("Сплошной текст из PDF без разделителей")).toBe(false);
  });

  it("делает заголовок из имени файла", () => {
    expect(titleFromFileName("Dorelan_Mattresses_Overview.pdf")).toBe(
      "Dorelan Mattresses Overview",
    );
    expect(titleFromFileName("traumina-bot-catalog.pdf")).toBe("traumina bot catalog");
    expect(titleFromFileName(".pdf")).toBe("Документ");
  });

  it("предел размера задан одним числом для сервера и формы", () => {
    expect(KNOWLEDGE_FILE_MAX_MB).toBe(3);
  });
});

describe("PDF и Word", () => {
  it("достаёт текст из настоящего PDF", async () => {
    const res = await extractDocumentText(
      await pdf(["Dorelan mattresses", "Made in Italy"]),
      "dorelan.pdf",
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.text).toContain("Dorelan mattresses");
      expect(res.text).toContain("Made in Italy");
    }
  });

  it("PDF без текста (скан) — понятная ошибка, а не пустая статья", async () => {
    expect(await extractDocumentText(await pdf([]), "scan.pdf")).toEqual({
      ok: false,
      error: "pdfScan",
    });
  });

  it("достаёт абзацы из .docx: кириллица, сущности, табуляция", async () => {
    const file = docx(
      para("### Уход за полотенцами") +
        para("Теги: уход, стирка") +
        para("Стирка при 40", "°C &amp; без отбеливателя") +
        "<w:p><w:r><w:t>Размер</w:t><w:tab/><w:t>70x140</w:t></w:r></w:p>",
    );
    expect(await extractDocumentText(file, "уход.docx")).toEqual({
      ok: true,
      text: "### Уход за полотенцами\nТеги: уход, стирка\nСтирка при 40°C & без отбеливателя\nРазмер\t70x140",
    });
  });

  it("узнаёт .docx по сигнатуре zip без расширения", async () => {
    const res = await extractDocumentText(docx(para("Fabric")), "upload");
    expect(res).toEqual({ ok: true, text: "Fabric" });
  });

  it("битый .docx и старый .doc — свои ошибки", async () => {
    expect(await extractDocumentText(encode("PK не zip"), "x.docx")).toEqual({
      ok: false,
      error: "docxBroken",
    });
    const ole = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    expect(await extractDocumentText(ole, "old")).toEqual({ ok: false, error: "oldDoc" });
    expect(await extractDocumentText(docx(""), "empty.docx")).toEqual({
      ok: false,
      error: "empty",
    });
  });

  it("удалённый правкой текст и коды полей в статью не попадают", () => {
    expect(
      textFromDocumentXml(
        `<w:p><w:r><w:t>Цена</w:t></w:r><w:del><w:r><w:delText>старая</w:delText></w:r></w:del><w:r><w:instrText>PAGE</w:instrText></w:r></w:p>`,
      ),
    ).toBe("Цена");
  });
});
