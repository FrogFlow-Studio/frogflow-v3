/**
 * Проверка файла по содержимому. Тип из бакета ставит браузер при загрузке,
 * расширение задаёт имя — оба можно подделать: `.exe` или HTML с именем
 * `.pdf` прошёл бы. Здесь первые байты сверяются с форматом, который обещает
 * расширение. Модуль без node-зависимостей.
 */
const SIGNATURES: Record<string, number[][]> = {
  jpg: [[0xff, 0xd8, 0xff]],
  jpeg: [[0xff, 0xd8, 0xff]],
  png: [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  pdf: [[0x25, 0x50, 0x44, 0x46, 0x2d]], // %PDF-
  // ZIP и форматы Office 2007+ (это ZIP внутри).
  zip: [[0x50, 0x4b, 0x03, 0x04]],
  docx: [[0x50, 0x4b, 0x03, 0x04]],
  xlsx: [[0x50, 0x4b, 0x03, 0x04]],
  pptx: [[0x50, 0x4b, 0x03, 0x04]],
  // Старые doc/xls/ppt — составной документ OLE.
  doc: [[0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]],
  xls: [[0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]],
  ppt: [[0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]],
};

function startsWith(bytes: Uint8Array, sig: number[]): boolean {
  return bytes.length >= sig.length && sig.every((b, i) => bytes[i] === b);
}

/** Текст: корректный UTF-8 без нулевых байтов (у программ и архивов они есть). */
function isPlainText(bytes: Uint8Array): boolean {
  if (bytes.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

/** Содержимое соответствует расширению. Незнакомое расширение — нет. */
export function contentMatchesExt(ext: string, bytes: Uint8Array): boolean {
  const e = ext.toLowerCase();
  if (e === "txt") return bytes.length > 0 && isPlainText(bytes);
  const sigs = SIGNATURES[e];
  return Boolean(sigs?.some((s) => startsWith(bytes, s)));
}
