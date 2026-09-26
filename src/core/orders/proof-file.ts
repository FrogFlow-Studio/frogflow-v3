/**
 * Проверка файла чека до загрузки в хранилище, как в v1
 * (payment-proof.server.ts): только картинка или PDF, не пустой и не больше
 * 20 МБ. Решает содержимое, а не заявленный тип: Telegram отдаёт файлы как
 * application/octet-stream, CDN Instagram подписывает тип неточно. Настоящее
 * фото или PDF принимается под своим типом, что бы ни было заявлено; всё
 * остальное (HTML, видео, архив) — нет, даже с типом image/jpeg.
 *
 * Картинки: JPEG, PNG, WebP, HEIC/HEIF и AVIF (фото с новых телефонов).
 * PDF — по метке «%PDF» в первых 1024 байтах, как у Acrobat: некоторые
 * генераторы чеков пишут перед ней мусор.
 */
export const MAX_PROOF_BYTES = 20 * 1024 * 1024;

const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/avif": "avif",
  "application/pdf": "pdf",
};

/**
 * Подтипы ISO BMFF, которые означают HEIC/HEIF. Метка «ftyp» есть и у видео
 * MP4/MOV (isom, mp42, qt), поэтому одной её мало.
 */
const HEIC_BRANDS = new Set([
  "heic",
  "heix",
  "hevc",
  "hevx",
  "heim",
  "heis",
  "hevm",
  "hevs",
  "mif1",
  "msf1",
]);

/** Подтипы AVIF: картинка и последовательность кадров. */
const AVIF_BRANDS = new Set(["avif", "avis"]);

/** Где искать метку PDF: в первых 1024 байтах целиком. */
const PDF_HEADER_WINDOW = 1024;

const ascii = (bytes: Uint8Array, from: number, to: number) =>
  String.fromCharCode(...bytes.subarray(from, to));

export function sniffProofMime(bytes: Uint8Array): string | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes[0] === 0x89 && ascii(bytes, 1, 4) === "PNG") return "image/png";
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") return "image/webp";
  if (ascii(bytes, 4, 8) === "ftyp") {
    const brand = ascii(bytes, 8, 12).toLowerCase();
    if (AVIF_BRANDS.has(brand)) return "image/avif";
    if (HEIC_BRANDS.has(brand)) return "image/heic";
  }
  // Последним: метку ищем не в начале, картинки опознаны раньше.
  if (ascii(bytes, 0, PDF_HEADER_WINDOW).includes("%PDF")) return "application/pdf";
  return null;
}

export type ProofFileCheck =
  | { ok: true; mime: string; ext: string }
  | { ok: false; reason: "invalid_file" | "file_too_large" };

/** Заявленный тип (`mime`) не учитывается: см. комментарий к файлу. */
export function validateProofFile(file: { bytes: Uint8Array; mime: string }): ProofFileCheck {
  if (!file.bytes.length) return { ok: false, reason: "invalid_file" };
  if (file.bytes.length > MAX_PROOF_BYTES) return { ok: false, reason: "file_too_large" };
  const sniffed = sniffProofMime(file.bytes);
  if (!sniffed) return { ok: false, reason: "invalid_file" };
  return { ok: true, mime: sniffed, ext: EXT[sniffed]! };
}
