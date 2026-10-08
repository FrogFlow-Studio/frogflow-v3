/**
 * Excel (.xlsx) → CSV без зависимостей (Р1). Файл .xlsx — zip с XML: читаем
 * оглавление zip, берём первый лист и общие строки и отдаём CSV, который
 * дальше разбирает тот же parseCatalogCsv. Формулы читаются как последнее
 * вычисленное значение, даты приходят числом (как их хранит Excel), поэтому
 * для дат и артикулов с ведущими нулями продавцу лучше формат «Текст».
 * Защита от «бомбы»: размер распакованного листа и число строк ограничены.
 */
import { inflateRawSync } from "node:zlib";
import { UserError } from "@/core/i18n/user-error";

const MAX_XML = 25 * 1024 * 1024;
const MAX_ROWS = 5000;
const MAX_COLS = 60;

type Entry = { name: string; method: number; csize: number; offset: number };

function entries(buf: Buffer): Map<string, Entry> {
  // Конец центрального каталога: сигнатура PK\5\6 в последних 64 КБ.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--)
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  if (eocd < 0) throw new UserError("err.xlsx.bad", "Не похоже на файл Excel (.xlsx)");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = new Map<string, Entry>();
  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50)
      throw new UserError("err.xlsx.bad", "Не похоже на файл Excel (.xlsx)");
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const offset = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString("utf8");
    out.set(name, { name, method, csize, offset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

function read(buf: Buffer, e: Entry): string {
  const h = e.offset;
  if (h + 30 > buf.length || buf.readUInt32LE(h) !== 0x04034b50)
    throw new UserError("err.xlsx.bad", "Не похоже на файл Excel (.xlsx)");
  const start = h + 30 + buf.readUInt16LE(h + 26) + buf.readUInt16LE(h + 28);
  const raw = buf.subarray(start, start + e.csize);
  if (e.method === 0) return raw.toString("utf8");
  if (e.method !== 8) throw new UserError("err.xlsx.bad", "Не похоже на файл Excel (.xlsx)");
  try {
    return inflateRawSync(raw, { maxOutputLength: MAX_XML }).toString("utf8");
  } catch {
    throw new UserError("err.xlsx.big", "Лист Excel слишком большой — сохраните его как CSV");
  }
}

const unxml = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&");

/** Текст из <t>…</t> внутри фрагмента (общие строки бывают «кусками» rich text). */
const textOf = (xml: string) =>
  unxml([...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join(""));

/** «B3» → индекс колонки 1. */
function colIndex(ref: string): number {
  let n = 0;
  for (const ch of ref.replace(/[^A-Za-z]/g, "").toUpperCase()) n = n * 26 + ch.charCodeAt(0) - 64;
  return n - 1;
}

const csvCell = (v: string) => (/[",;\n\r\t]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/**
 * `singleLine` — перевод строки внутри ячейки становится пробелом: разбор
 * прайса консультанта (pricelist/import) режет текст на строки до кавычек, и
 * ячейка «Полотенце\n70x140» из Excel разорвала бы позицию надвое.
 * Строк больше MAX_ROWS — ошибка, а не молча обрезанный файл.
 */
export function xlsxToCsv(buf: Buffer, opts: { singleLine?: boolean } = {}): string {
  const files = entries(buf);
  const sheetName = [...files.keys()]
    .filter((n) => /^xl\/worksheets\/[^/]+\.xml$/.test(n))
    .sort((a, b) => a.localeCompare(b, "en", { numeric: true }))[0];
  if (!sheetName) throw new UserError("err.xlsx.bad", "Не похоже на файл Excel (.xlsx)");
  const sst = files.get("xl/sharedStrings.xml");
  const shared = sst
    ? [...read(buf, sst).matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]!))
    : [];
  const sheet = read(buf, files.get(sheetName)!);
  const rows: string[][] = [];
  for (const rm of sheet.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    if (rows.length >= MAX_ROWS)
      throw new UserError(
        "err.xlsx.tooManyRows",
        "В файле больше {max} строк. Разделите его или удалите пустые строки.",
        { max: MAX_ROWS },
      );
    const row: string[] = [];
    for (const cm of rm[1]!.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1]!;
      const ref = /\br="([A-Z]+\d+)"/.exec(attrs)?.[1];
      const idx = ref ? colIndex(ref) : row.length;
      if (idx < 0 || idx >= MAX_COLS) continue;
      const type = /\bt="([^"]+)"/.exec(attrs)?.[1];
      const body = cm[2] ?? "";
      const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let value = "";
      if (type === "s") value = shared[Number(v)] ?? "";
      else if (type === "inlineStr") value = textOf(body);
      else if (type === "b") value = v === "1" ? "да" : "нет";
      else if (v !== undefined) value = unxml(v);
      while (row.length < idx) row.push("");
      row[idx] = opts.singleLine ? value.replace(/\s*[\r\n]+\s*/g, " ") : value;
    }
    rows.push(row);
  }
  return rows.map((r) => r.map(csvCell).join(",")).join("\n");
}
