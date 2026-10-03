import { cleanLeadInput, type LeadInput } from "./leads";

/**
 * Импорт лидов из CSV: разбор файла в лиды (чистая часть). Столбцы находятся
 * по заголовку (русские и английские названия), порядок любой, разделитель —
 * запятая, точка с запятой или табуляция (Excel по-русски сохраняет «;»).
 * Дубли и запись в базу — на стороне сервера (app/operator/leads-import.server).
 */
export const MAX_IMPORT_ROWS = 200;
export const MAX_IMPORT_BYTES = 300_000;

const COLUMN_ALIASES: Record<keyof Omit<LeadInput, "signals"> | "signals", string[]> = {
  businessName: ["название", "компания", "бизнес", "name", "business", "business_name", "company"],
  niche: ["ниша", "niche", "category", "категория"],
  city: ["город", "city"],
  phone: ["телефон", "тел", "phone", "whatsapp", "mobile"],
  instagramHandle: ["instagram", "инстаграм", "инста", "ig"],
  email: ["почта", "email", "e-mail", "mail", "эл. почта"],
  websiteUrl: ["сайт", "website", "site", "url", "web"],
  signals: ["заметка", "заметки", "комментарий", "signals", "note", "notes", "comment"],
};

export type ImportColumn = keyof typeof COLUMN_ALIASES;

export type CsvLead = { line: number; input: LeadInput };
export type CsvRowError = { line: number; message: string };
export type CsvParse =
  { ok: false; error: string } | { ok: true; leads: CsvLead[]; errors: CsvRowError[] };

/** Разбор CSV по RFC 4180: кавычки, удвоенные кавычки, переносы строк внутри поля. */
export function parseCsvRows(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"' && field === "") quoted = true;
    else if (c === delimiter) {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** Разделитель по строке заголовка: чаще всего встречающийся из «, ; табуляция». */
export function detectDelimiter(text: string): string {
  const head = text.split(/\r?\n/, 1)[0] ?? "";
  const count = (d: string) => head.split(d).length - 1;
  return [";", "\t", ","].reduce((best, d) => (count(d) > count(best) ? d : best), ",");
}

function columnIndexes(header: string[]): Partial<Record<ImportColumn, number>> {
  const out: Partial<Record<ImportColumn, number>> = {};
  header.forEach((h, i) => {
    const name = h.trim().toLowerCase();
    for (const [col, aliases] of Object.entries(COLUMN_ALIASES) as [ImportColumn, string[]][])
      if (out[col] === undefined && aliases.includes(name)) out[col] = i;
  });
  return out;
}

export function parseLeadsCsv(raw: string): CsvParse {
  if (raw.length > MAX_IMPORT_BYTES)
    return { ok: false, error: `Файл слишком большой: не больше ${MAX_IMPORT_BYTES / 1000} КБ` };
  const text = raw.replace(/^\uFEFF/, "");
  const rows = parseCsvRows(text, detectDelimiter(text)).filter((r) => r.some((c) => c.trim()));
  if (rows.length === 0) return { ok: false, error: "Файл пустой" };
  const idx = columnIndexes(rows[0]!);
  if (idx.businessName === undefined)
    return {
      ok: false,
      error: "В первой строке нужны заголовки; обязательный столбец — «Название» (name)",
    };
  const data = rows.slice(1);
  if (data.length === 0) return { ok: false, error: "В файле только заголовок, лидов нет" };
  if (data.length > MAX_IMPORT_ROWS)
    return {
      ok: false,
      error: `В файле ${data.length} строк, за раз можно не больше ${MAX_IMPORT_ROWS}: разбейте файл`,
    };
  const leads: CsvLead[] = [];
  const errors: CsvRowError[] = [];
  data.forEach((cells, k) => {
    const line = k + 2;
    const cell = (c: ImportColumn) => {
      const i = idx[c];
      return i === undefined ? "" : (cells[i] ?? "");
    };
    const input = cleanLeadInput({
      businessName: cell("businessName"),
      niche: cell("niche"),
      city: cell("city"),
      websiteUrl: cell("websiteUrl"),
      instagramHandle: cell("instagramHandle"),
      phone: cell("phone"),
      email: cell("email"),
      signals: cell("signals"),
    });
    if (input) leads.push({ line, input });
    else if (!cell("businessName").trim()) errors.push({ line, message: "нет названия" });
    else
      errors.push({
        line,
        message: "нет рабочего контакта: Instagram, телефон, почта или сайт в правильном виде",
      });
  });
  return { ok: true, leads, errors };
}
