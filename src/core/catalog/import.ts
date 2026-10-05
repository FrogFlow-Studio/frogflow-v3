/**
 * Импорт каталога из CSV/Excel-выгрузки — чистая часть: разбор текста,
 * сопоставление колонок по русским и английским заголовкам, приведение
 * значений. Применение к базе — import.server.ts. Файл продавца никогда
 * не бывает «правильным»: разделители, кавычки, «1 500,50», «да/нет»,
 * лишние колонки — всё это принимается, а не отвергается.
 */

export type ImportField =
  | "id"
  | "name"
  | "price"
  | "currency"
  | "category"
  | "description"
  | "keywords"
  | "active"
  | "stock"
  | "fileUrl"
  | "fileUrlKz"
  | "sortOrder"
  | "kind"
  | "sku"
  | "photos";

/** Строк за один импорт; сверх этого файл режем явно, с ошибкой, а не молча. */
export const MAX_IMPORT_ROWS = 1000;
/** Фото на товар из одной ячейки. */
export const MAX_IMPORT_PHOTOS = 5;

const ALIASES: Record<ImportField, string[]> = {
  id: ["id", "ид", "идентификатор"],
  name: ["название", "наименование", "товар", "name", "title", "product"],
  price: ["цена", "стоимость", "price", "cost"],
  currency: ["валюта", "currency"],
  category: ["категория", "категории", "раздел", "category", "categories"],
  description: ["описание", "description", "desc"],
  keywords: ["ключевые слова", "ключевые", "теги", "keywords", "tags"],
  active: ["активен", "активный", "в продаже", "показывать", "active", "is_active", "visible"],
  stock: ["остаток", "количество", "кол-во", "stock", "stock_quantity", "qty", "quantity"],
  fileUrl: ["ссылка", "файл", "материал", "ссылка ru", "file_url", "url", "link", "file"],
  fileUrlKz: [
    "ссылка kz",
    "ссылка кз",
    "файл kz",
    "материал kz",
    "file_url_kz",
    "url_kz",
    "link_kz",
  ],
  sortOrder: ["порядок", "сортировка", "sort", "sort_order", "order"],
  kind: ["тип", "вид", "fulfillment_kind", "kind", "type"],
  sku: ["артикул", "арт", "код товара", "sku", "article", "vendor code"],
  photos: [
    "фото",
    "фотографии",
    "изображения",
    "картинки",
    "ссылки на фото",
    "photo",
    "photos",
    "image",
    "images",
    "image url",
  ],
};

export const IMPORT_FIELD_TITLES: Record<ImportField, string> = {
  id: "id",
  name: "Название",
  price: "Цена",
  currency: "Валюта",
  category: "Категория",
  description: "Описание",
  keywords: "Ключевые слова",
  active: "В продаже",
  stock: "Остаток",
  fileUrl: "Ссылка на материал",
  fileUrlKz: "Ссылка на материал (kk)",
  sortOrder: "Порядок",
  kind: "Тип",
  sku: "Артикул",
  photos: "Фото (ссылки)",
};

const norm = (s: string) =>
  s
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .replace(/[_\-.]+/g, " ")
    .replace(/\s+/g, " ");

/** Разделитель — тот, которого больше в строке заголовка вне кавычек. */
export function detectDelimiter(headerLine: string): string {
  let best = ",";
  let max = -1;
  for (const d of [";", ",", "\t", "|"]) {
    let n = 0;
    let quoted = false;
    for (const ch of headerLine) {
      if (ch === '"') quoted = !quoted;
      else if (ch === d && !quoted) n++;
    }
    if (n > max) {
      max = n;
      best = d;
    }
  }
  return best;
}

/** RFC 4180 с поблажками: кавычки внутри, переводы строк в кавычках, CRLF. */
export function parseCsv(text: string, delimiter?: string): string[][] {
  const src = text.replace(/^\uFEFF/, "");
  const firstLine = src.split(/\r?\n/, 1)[0] ?? "";
  const d = delimiter ?? detectDelimiter(firstLine);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === d) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}

export type ColumnMap = Partial<Record<ImportField, number>>;

/** Заголовок → поле; неизвестные колонки возвращаются отдельно, чтобы показать продавцу. */
export function matchColumns(header: string[]): { map: ColumnMap; unknown: string[] } {
  const map: ColumnMap = {};
  const unknown: string[] = [];
  header.forEach((raw, index) => {
    const h = norm(raw);
    if (!h) return;
    const field = (Object.keys(ALIASES) as ImportField[]).find(
      (f) => !(f in map) && ALIASES[f].some((a) => norm(a) === h),
    );
    if (field) map[field] = index;
    else unknown.push(raw.trim());
  });
  return { map, unknown };
}

export function parsePrice(raw: string): number | null {
  const s = raw.replace(/[^\d.,-]/g, "").replace(/\s+/g, "");
  if (!s) return null;
  // «1.500,50» и «1,500.50»: последний разделитель — десятичный.
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  let normalized: string;
  if (lastComma > lastDot) normalized = s.replace(/\./g, "").replace(",", ".");
  else normalized = s.replace(/,/g, "");
  const n = Number(normalized);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}

export function parseBool(raw: string, fallback = true): boolean {
  const s = norm(raw);
  if (!s) return fallback;
  if (["1", "да", "yes", "true", "y", "+", "вкл", "on", "активен", "в продаже"].includes(s))
    return true;
  if (["0", "нет", "no", "false", "n", "-", "выкл", "off", "скрыт", "нет в продаже"].includes(s))
    return false;
  return fallback;
}

export type ProductDraft = {
  line: number;
  id: string | null;
  name: string;
  price: number | null;
  currency: string | null;
  category: string | null;
  description: string | null;
  keywords: string | null;
  active: boolean | null;
  stock: number | null | undefined;
  fileUrl: string | null;
  fileUrlKz: string | null;
  sortOrder: number | null;
  kind: "digital" | "physical" | null;
  sku: string | null;
  /** null — колонки «Фото» нет; [] — есть, но в строке пусто. */
  photos: string[] | null;
};

export type ParsedImport = {
  drafts: ProductDraft[];
  errors: Array<{ line: number; message: string }>;
  /** Строка принята, но часть ячейки отброшена (например, неверная ссылка на фото). */
  warnings: Array<{ line: number; message: string }>;
  unknownColumns: string[];
  fields: ImportField[];
};

const cell = (row: string[], i: number | undefined) =>
  i === undefined ? undefined : (row[i] ?? "").trim();

/** Артикул для сравнения: без регистра и лишних пробелов, не длиннее 64. */
export const skuKey = (raw: string) => raw.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 64);

/** Ссылки на фото из ячейки: только https, не больше MAX_IMPORT_PHOTOS; негодное — в `bad`. */
export function parsePhotoLinks(raw: string): { urls: string[]; bad: string[] } {
  const urls: string[] = [];
  const bad: string[] = [];
  for (const part of raw.split(/[\s;|]+/)) {
    const p = part.trim();
    if (!p) continue;
    let ok = false;
    try {
      const u = new URL(p);
      ok = u.protocol === "https:" && p.length <= 500 && !u.username && !u.password;
    } catch {
      ok = false;
    }
    if (!ok) bad.push(p.slice(0, 60));
    else if (!urls.includes(p)) urls.push(p);
  }
  return { urls: urls.slice(0, MAX_IMPORT_PHOTOS), bad: bad.concat(urls.slice(MAX_IMPORT_PHOTOS)) };
}

/** maxRows — потолок строк за раз (загрузка файла); таблица по ссылке читается целиком, её вторую тысячу терять нельзя. */
export function parseCatalogCsv(text: string, opts: { maxRows?: number } = {}): ParsedImport {
  const maxRows = opts.maxRows ?? Infinity;
  const rows = parseCsv(text);
  if (rows.length === 0)
    return {
      drafts: [],
      errors: [{ line: 0, message: "Файл пуст" }],
      warnings: [],
      unknownColumns: [],
      fields: [],
    };
  const { map, unknown } = matchColumns(rows[0]!);
  const fields = Object.keys(map) as ImportField[];
  if (map.name === undefined)
    return {
      drafts: [],
      errors: [{ line: 1, message: "Не нашёл колонку с названием товара («Название» или «name»)" }],
      warnings: [],
      unknownColumns: unknown,
      fields,
    };
  const drafts: ProductDraft[] = [];
  const errors: Array<{ line: number; message: string }> = [];
  const warnings: Array<{ line: number; message: string }> = [];
  const dataRows = rows.slice(1);
  if (dataRows.length > maxRows)
    errors.push({
      line: maxRows + 2,
      message: `В файле ${dataRows.length} строк, за один раз берём ${maxRows}: остальные не обработаны — загрузите их вторым файлом`,
    });
  const firstSeen = new Map<string, number>();
  dataRows.slice(0, maxRows).forEach((row, i) => {
    const line = i + 2;
    const name = cell(row, map.name) ?? "";
    if (!name) {
      errors.push({ line, message: "Пустое название — строка пропущена" });
      return;
    }
    const sku = cell(row, map.sku) ? skuKey(cell(row, map.sku)!) : null;
    // Один товар дважды в файле: берём первую строку, повтор не создаёт второй.
    const dupKey = sku ? `sku:${sku}` : `name:${name.trim().toLowerCase()}`;
    const was = firstSeen.get(dupKey);
    if (was !== undefined) {
      errors.push({
        line,
        message: `«${name}» уже есть в строке ${was} — повтор пропущен`,
      });
      return;
    }
    const priceRaw = cell(row, map.price);
    const price = priceRaw === undefined ? null : parsePrice(priceRaw);
    if (priceRaw !== undefined && priceRaw !== "" && price === null) {
      errors.push({ line, message: `Не понял цену «${priceRaw}» у «${name}» — строка пропущена` });
      return;
    }
    firstSeen.set(dupKey, line);
    let photos: string[] | null = null;
    if (map.photos !== undefined) {
      const links = parsePhotoLinks(cell(row, map.photos) ?? "");
      photos = links.urls;
      if (links.bad.length)
        warnings.push({
          line,
          message: `у «${name}» не взяты ссылки на фото (нужен https, не больше ${MAX_IMPORT_PHOTOS}): ${links.bad.join(", ")}`,
        });
    }
    const stockRaw = cell(row, map.stock);
    const kindRaw = norm(cell(row, map.kind) ?? "");
    drafts.push({
      line,
      id: cell(row, map.id) || null,
      name: name.slice(0, 200),
      price,
      currency: (cell(row, map.currency) || null)?.toUpperCase().slice(0, 3) ?? null,
      category: cell(row, map.category) || null,
      description: map.description === undefined ? null : (cell(row, map.description) ?? ""),
      keywords: map.keywords === undefined ? null : (cell(row, map.keywords) ?? ""),
      active: map.active === undefined ? null : parseBool(cell(row, map.active) ?? ""),
      stock:
        map.stock === undefined
          ? undefined
          : stockRaw
            ? Number.isFinite(Number(stockRaw))
              ? Math.max(0, Math.trunc(Number(stockRaw)))
              : null
            : null,
      fileUrl: cell(row, map.fileUrl) || null,
      fileUrlKz: cell(row, map.fileUrlKz) || null,
      sortOrder:
        map.sortOrder === undefined || !cell(row, map.sortOrder)
          ? null
          : Math.trunc(Number(cell(row, map.sortOrder))) || 0,
      kind: kindRaw
        ? /физ|physical|товар/.test(kindRaw)
          ? "physical"
          : /цифр|digital|файл|материал/.test(kindRaw)
            ? "digital"
            : null
        : null,
      sku,
      photos,
    });
  });
  return { drafts, errors, warnings, unknownColumns: unknown, fields };
}

export type ExistingProduct = { id: string; name: string };
export type PlanMatch = "id" | "sku" | "name";

/**
 * Что сделает импорт: по id, затем по артикулу (skus: артикул → id товара),
 * затем по названию без учёта регистра — обновить, иначе создать. Один
 * существующий товар обновляется не больше одного раза: повторная строка на
 * него попадает в `repeats`, а не превращается во второй новый товар.
 */
export function planImport(
  drafts: ProductDraft[],
  existing: ExistingProduct[],
  skus: ReadonlyMap<string, string> = new Map(),
): {
  create: ProductDraft[];
  update: Array<{ id: string; by: PlanMatch; draft: ProductDraft }>;
  unmatchedIds: ProductDraft[];
  repeats: ProductDraft[];
} {
  const byId = new Map(existing.map((p) => [p.id, p]));
  const byName = new Map(existing.map((p) => [p.name.trim().toLowerCase(), p]));
  const create: ProductDraft[] = [];
  const update: Array<{ id: string; by: PlanMatch; draft: ProductDraft }> = [];
  const unmatchedIds: ProductDraft[] = [];
  const repeats: ProductDraft[] = [];
  const seen = new Set<string>();
  for (const d of drafts) {
    let hit: { id: string; by: PlanMatch } | null = null;
    if (d.id) {
      if (byId.has(d.id)) hit = { id: d.id, by: "id" };
      else unmatchedIds.push(d);
    }
    if (!hit && d.sku) {
      const id = skus.get(d.sku);
      if (id && byId.has(id)) hit = { id, by: "sku" };
    }
    if (!hit) {
      const p = byName.get(d.name.trim().toLowerCase());
      if (p) hit = { id: p.id, by: "name" };
    }
    if (!hit) {
      create.push(d);
      continue;
    }
    if (seen.has(hit.id)) {
      repeats.push(d);
      continue;
    }
    seen.add(hit.id);
    update.push({ id: hit.id, by: hit.by, draft: d });
  }
  return { create, update, unmatchedIds, repeats };
}
