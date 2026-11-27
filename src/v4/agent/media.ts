import type Anthropic from "@anthropic-ai/sdk";

/**
 * Голосовые и фото покупателя (часть 2 плана, «Голос и картинки»). Канал (этап 2)
 * сам скачивает файл и отдаёт ядру загрузчик: ссылка на файл Telegram несёт токен
 * бота, поэтому ни в журнал, ни в логи, ни модели она не попадает — только байты.
 * Файл в журнале не хранится: голосовое — расшифровкой, фото — подписью и пометкой.
 */

export type MediaFile = { bytes: Uint8Array; mediaType: string };

export type IncomingMedia =
  | {
      kind: "voice";
      /** Длительность из канала (Telegram и WhatsApp её дают); нет — считаем по пределу. */
      durationSec: number | null;
      load: () => Promise<MediaFile>;
    }
  | { kind: "photo"; load: () => Promise<MediaFile> };

/** Расшифровка: текст или null (не разобрали, сбой, тайм-аут — без повторов). */
export type Transcriber = (f: MediaFile) => Promise<string | null>;

/** Whisper: 0,006 $ за минуту — 100 микродолларов за секунду, с наценкой из кошелька. */
export const VOICE_MICRO_USD_PER_SECOND = 100;
/** Длиннее — не расшифровываем: просим написать коротко текстом. */
export const VOICE_MAX_SECONDS = 300;
/** Предел Whisper API. */
export const VOICE_MAX_BYTES = 25 * 1024 * 1024;

/** Цена расшифровки по длительности; неизвестна — как за предел (бронь с запасом). */
export function voiceCostMicroUsd(durationSec: number | null): number {
  const sec =
    durationSec && Number.isFinite(durationSec) && durationSec > 0
      ? Math.min(Math.ceil(durationSec), VOICE_MAX_SECONDS)
      : VOICE_MAX_SECONDS;
  return sec * VOICE_MICRO_USD_PER_SECOND;
}

export const voiceTooLong = (durationSec: number | null) =>
  durationSec !== null && durationSec > VOICE_MAX_SECONDS;

/** Форматы картинок, которые принимает модель. */
export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;
type ImageType = (typeof IMAGE_TYPES)[number];
/** Предел API на одну картинку. */
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;

/** Тип по первым байтам: заголовку канала не верим (Telegram отдаёт octet-stream). */
export function sniffImageType(b: Uint8Array): ImageType | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47)
    return "image/png";
  if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return "image/gif";
  if (
    b.length >= 12 &&
    b[0] === 0x52 &&
    b[1] === 0x49 &&
    b[2] === 0x46 &&
    b[3] === 0x46 &&
    b[8] === 0x57 &&
    b[9] === 0x45 &&
    b[10] === 0x42 &&
    b[11] === 0x50
  )
    return "image/webp";
  return null;
}

/** Блок картинки для модели или причина, почему фото не открылось. */
export function imageBlock(
  f: MediaFile,
): { ok: true; block: Anthropic.ImageBlockParam } | { ok: false; reason: "size" | "type" } {
  if (!f.bytes.length || f.bytes.length > IMAGE_MAX_BYTES) return { ok: false, reason: "size" };
  const type = sniffImageType(f.bytes);
  if (!type) return { ok: false, reason: "type" };
  return {
    ok: true,
    block: {
      type: "image",
      source: { type: "base64", media_type: type, data: Buffer.from(f.bytes).toString("base64") },
    },
  };
}
