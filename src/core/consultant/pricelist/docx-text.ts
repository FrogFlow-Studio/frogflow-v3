import { inflateRawSync } from "node:zlib";

/**
 * Текст документа Word (.docx) без сторонних библиотек. v1 брал mammoth, но
 * для базы знаний нужен только сплошной текст с абзацами: .docx — это zip, в
 * котором word/document.xml; zip распаковывает встроенный node:zlib, а
 * абзацы и текст достаются из разметки WordprocessingML (<w:p>, <w:t>).
 *
 * Только сервер: node:zlib в браузерный бандл не попадает.
 */

/** Предел на распакованный document.xml: защита от «zip-бомбы». */
const MAX_XML_BYTES = 30 * 1024 * 1024;

type ZipEntry = { name: string; method: number; size: number; offset: number; packed: number };

function u16(b: Uint8Array, at: number): number {
  return b[at]! | (b[at + 1]! << 8);
}
function u32(b: Uint8Array, at: number): number {
  return (b[at]! | (b[at + 1]! << 8) | (b[at + 2]! << 16) | (b[at + 3]! << 24)) >>> 0;
}

/** Оглавление zip (central directory). null — это не zip или он испорчен. */
function zipEntries(b: Uint8Array): ZipEntry[] | null {
  // Конец оглавления (EOCD, PK\x05\x06) — в последних 64 КБ + 22 байта.
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65_557); i--) {
    if (u32(b, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;
  const count = u16(b, eocd + 10);
  let at = u32(b, eocd + 16);
  const out: ZipEntry[] = [];
  for (let n = 0; n < count; n++) {
    if (at + 46 > b.length || u32(b, at) !== 0x02014b50) return null;
    const method = u16(b, at + 10);
    const packed = u32(b, at + 20);
    const size = u32(b, at + 24);
    const nameLen = u16(b, at + 28);
    const extraLen = u16(b, at + 30);
    const commentLen = u16(b, at + 32);
    const offset = u32(b, at + 42);
    const name = new TextDecoder().decode(b.subarray(at + 46, at + 46 + nameLen));
    out.push({ name, method, size, offset, packed });
    at += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

function readEntry(b: Uint8Array, e: ZipEntry): Uint8Array | null {
  if (e.offset + 30 > b.length || u32(b, e.offset) !== 0x04034b50) return null;
  const start = e.offset + 30 + u16(b, e.offset + 26) + u16(b, e.offset + 28);
  const data = b.subarray(start, start + e.packed);
  if (e.method === 0) return data;
  if (e.method !== 8) return null;
  if (e.size > MAX_XML_BYTES) return null;
  return inflateRawSync(data, { maxOutputLength: MAX_XML_BYTES });
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code: string) => {
    if (code[0] === "#") {
      const n =
        code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : Number(code.slice(1));
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[code.toLowerCase()] ?? m;
  });
}

/** Текст из WordprocessingML: абзац — строка, табуляция и разрыв строки сохраняются. */
export function textFromDocumentXml(xml: string): string {
  const body = xml.replace(
    /<w:(?:instrText|delText)\b[^>]*>[\s\S]*?<\/w:(?:instrText|delText)>/g,
    "",
  );
  const out: string[] = [];
  for (const para of body.split(/<\/w:p>/)) {
    let line = "";
    for (const m of para.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:(tab|br|cr)\b[^>]*\/>/g)) {
      if (m[1] !== undefined) line += decodeEntities(m[1]);
      else if (m[2] === "tab") line += "\t";
      else line += "\n";
    }
    out.push(line);
  }
  return out
    .join("\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Текст .docx; null — файл не читается как документ Word. */
export function extractDocxText(bytes: Uint8Array): string | null {
  const entries = zipEntries(bytes);
  if (!entries) return null;
  const doc = entries.find((e) => e.name === "word/document.xml");
  if (!doc) return null;
  const xml = readEntry(bytes, doc);
  if (!xml) return null;
  return textFromDocumentXml(new TextDecoder("utf-8").decode(xml));
}
