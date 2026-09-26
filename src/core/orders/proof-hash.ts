import { createHash } from "node:crypto";
import { sniffProofMime } from "./proof-file";

/**
 * Отпечаток чека для проверки «этот же чек уже был по другому заказу».
 *
 * Хэш сырых байтов обходится легко: мусор перед «%PDF» (его принимает
 * proof-file) или байты после конца картинки файл не портят, а хэш меняют.
 * Поэтому считаем хэш содержимого: PDF — от «%PDF» до первого «%%EOF»,
 * JPEG — от начала до настоящего маркера конца (с разбором сегментов, чтобы
 * вписанный в хвост FF D9 не сдвигал границу), PNG — до чанка IEND, WebP —
 * по длине из заголовка RIFF. У чистого файла содержимое — весь файл, и
 * отпечаток совпадает с прежним хэшем сырых байтов.
 *
 * Сверяем оба (`all`): чеки, записанные раньше с хэшем сырых байтов,
 * по-прежнему узнаются. Пишем в заказ `stored` — отпечаток содержимого.
 */
export function proofHashes(bytes: Uint8Array): { stored: string; all: string[] } {
  const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
  const raw = sha(bytes);
  const content = sha(proofContent(bytes));
  return { stored: content, all: content === raw ? [raw] : [content, raw] };
}

export function proofContent(bytes: Uint8Array): Uint8Array {
  switch (sniffProofMime(bytes)) {
    case "application/pdf":
      return pdfContent(bytes);
    case "image/jpeg":
      return bytes.subarray(0, jpegEnd(bytes) ?? bytes.length);
    case "image/png":
      return bytes.subarray(0, pngEnd(bytes) ?? bytes.length);
    case "image/webp": {
      const size = u32le(bytes, 4);
      const end = size == null ? bytes.length : Math.min(bytes.length, 8 + size);
      return bytes.subarray(0, end);
    }
    default:
      return bytes;
  }
}

function indexOfAscii(bytes: Uint8Array, text: string, from = 0, to = bytes.length): number {
  const codes = Array.from(text, (c) => c.charCodeAt(0));
  outer: for (let i = from; i + codes.length <= to; i++) {
    for (let j = 0; j < codes.length; j++) if (bytes[i + j] !== codes[j]) continue outer;
    return i;
  }
  return -1;
}

function pdfContent(bytes: Uint8Array): Uint8Array {
  const start = Math.max(0, indexOfAscii(bytes, "%PDF", 0, Math.min(bytes.length, 1024 + 4)));
  const eof = indexOfAscii(bytes, "%%EOF", start);
  return bytes.subarray(start, eof < 0 ? bytes.length : eof + 5);
}

/** Конец JPEG (после FF D9) по сегментам и данным скана; null — файл не разобрался. */
function jpegEnd(b: Uint8Array): number | null {
  let i = 2;
  while (i + 1 < b.length) {
    if (b[i] !== 0xff) return null;
    const m = b[i + 1]!;
    if (m === 0xff) {
      i++;
      continue;
    }
    if (m === 0xd9) return i + 2;
    if (m === 0x01 || (m >= 0xd0 && m <= 0xd7)) {
      i += 2;
      continue;
    }
    if (i + 3 >= b.length) return null;
    const len = (b[i + 2]! << 8) | b[i + 3]!;
    if (len < 2) return null;
    i += 2 + len;
    if (m !== 0xda) continue;
    // Данные скана: FF 00 — байт данных, FF D0–D7 — рестарт, прочее FF xx — маркер.
    while (i + 1 < b.length) {
      if (b[i] === 0xff) {
        const n = b[i + 1]!;
        if (n === 0x00 || (n >= 0xd0 && n <= 0xd7) || n === 0xff) {
          i += n === 0xff ? 1 : 2;
          continue;
        }
        break;
      }
      i++;
    }
  }
  return null;
}

/** Конец PNG (после CRC чанка IEND); null — файл не разобрался. */
function pngEnd(b: Uint8Array): number | null {
  let i = 8;
  while (i + 8 <= b.length) {
    const len = ((b[i]! << 24) | (b[i + 1]! << 16) | (b[i + 2]! << 8) | b[i + 3]!) >>> 0;
    const type = String.fromCharCode(b[i + 4]!, b[i + 5]!, b[i + 6]!, b[i + 7]!);
    const next = i + 12 + len;
    if (next > b.length) return null;
    if (type === "IEND") return next;
    i = next;
  }
  return null;
}

function u32le(b: Uint8Array, at: number): number | null {
  if (at + 4 > b.length) return null;
  return (b[at]! | (b[at + 1]! << 8) | (b[at + 2]! << 16) | (b[at + 3]! << 24)) >>> 0;
}
