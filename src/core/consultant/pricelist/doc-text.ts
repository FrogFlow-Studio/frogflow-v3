/**
 * Текст из файла базы знаний (перенос src/lib/consultant/doc-text.ts v1).
 * Продавец присылает описания коллекций так, как их даёт фабрика, — PDF и
 * Word; перенабирать их руками незачем.
 *
 * Разбор на сервере: unpdf (уже в зависимостях — им читаются чеки) и свой
 * читатель .docx на node:zlib (docx-text.ts) вместо mammoth из v1.
 * Ошибки — кодами: текст на языке продавца даёт серверный слой админки.
 */
export {
  hasSectionMarkers,
  KNOWLEDGE_ARTICLE_MAX_CHARS,
  KNOWLEDGE_FILE_MAX_MB,
  titleFromFileName,
} from "./knowledge-import";

export type DocumentTextFailure =
  /** Пустой файл или в нём нет текста. */
  | "empty"
  /** PDF без текстового слоя — скан. */
  | "pdfScan"
  /** PDF не читается. */
  | "pdfBroken"
  /** Документ Word не читается. */
  | "docxBroken"
  /** Старый .doc (до 2007): его надо пересохранить в .docx. */
  | "oldDoc";

export type DocumentTextResult =
  { ok: true; text: string } | { ok: false; error: DocumentTextFailure };

export function decodeBase64(b64: string): Uint8Array {
  const raw = b64.includes(",") ? b64.slice(b64.indexOf(",") + 1) : b64;
  return Uint8Array.from(Buffer.from(raw, "base64"));
}

function isPdf(bytes: Uint8Array, fileName: string): boolean {
  if (/\.pdf$/i.test(fileName)) return true;
  // %PDF
  return bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
}

function isDocx(bytes: Uint8Array, fileName: string): boolean {
  if (/\.docx$/i.test(fileName)) return true;
  // PK.. — zip-контейнер, в котором лежит docx
  return bytes[0] === 0x50 && bytes[1] === 0x4b;
}

/** Составной файл OLE (D0 CF 11 E0) — старый Word .doc. */
function isOldDoc(bytes: Uint8Array, fileName: string): boolean {
  if (/\.doc$/i.test(fileName)) return true;
  return bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0;
}

export async function extractDocumentText(
  bytes: Uint8Array,
  fileName: string,
): Promise<DocumentTextResult> {
  if (bytes.length === 0) return { ok: false, error: "empty" };

  if (isPdf(bytes, fileName)) {
    try {
      const { extractText } = await import("unpdf");
      // Копия: pdf.js забирает (detach) буфер.
      const { text } = await extractText(bytes.slice(), { mergePages: true });
      const trimmed = text.trim();
      return trimmed ? { ok: true, text: trimmed } : { ok: false, error: "pdfScan" };
    } catch {
      return { ok: false, error: "pdfBroken" };
    }
  }

  if (isOldDoc(bytes, fileName)) return { ok: false, error: "oldDoc" };

  if (isDocx(bytes, fileName)) {
    try {
      const { extractDocxText } = await import("./docx-text");
      const text = extractDocxText(bytes);
      if (text === null) return { ok: false, error: "docxBroken" };
      return text ? { ok: true, text } : { ok: false, error: "empty" };
    } catch {
      return { ok: false, error: "docxBroken" };
    }
  }

  const text = new TextDecoder("utf-8")
    .decode(bytes)
    .replace(/^\uFEFF/, "")
    .trim();
  if (!text) return { ok: false, error: "empty" };
  return { ok: true, text };
}
